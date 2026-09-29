'use strict';

var control = require('./OperationControl');
var PacketReader = require('./protocol/PacketReader').PacketReader;
var prepared = require('./protocol/PreparedPackets');
var server = require('./protocol/ServerPackets');
var ResultStream = require('./ResultStream').ResultStream;
var MySqlError = require('./Connection').MySqlError;

function positiveInteger(value, fallback, name) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(name + ' must be a positive integer');
  return value;
}

function limitsFor(connection, options) {
  return {
    maxRows: positiveInteger(options.maxRows, connection.maxRows, 'MySQL maxRows'),
    maxResultBytes: positiveInteger(options.maxResultBytes, connection.maxResultBytes, 'MySQL maxResultBytes'),
    maxRowBytes: positiveInteger(options.maxRowBytes, connection.maxRowBytes, 'MySQL maxRowBytes')
  };
}

function initializeLimits(state, limits) {
  state.rowCount = 0;
  state.resultBytes = 0;
  state.maxRows = limits.maxRows;
  state.maxResultBytes = limits.maxResultBytes;
  state.maxRowBytes = limits.maxRowBytes;
}

function cleanupState(state) {
  if (!state || !state.cleanup) return;
  var cleanup = state.cleanup;
  state.cleanup = null;
  cleanup();
}

function install(runtime) {
  var Connection = runtime.Connection;
  var PreparedStatement = runtime.PreparedStatement;
  if (!Connection || !PreparedStatement || PreparedStatement.prototype.stream) return;

  PreparedStatement.prototype.stream = function stream(params, options) {
    if (this.closed) throw new Error('MySQL prepared statement is closed');
    params = params || [];
    if (!Array.isArray(params)) throw new TypeError('Prepared statement params must be an array');
    if (params.length !== this.parameterCount) throw new RangeError('Prepared statement expects ' + this.parameterCount + ' parameter(s), received ' + params.length);
    return this.connection._executePreparedStream(this, params, options || {});
  };

  Connection.prototype._executePreparedStream = function _executePreparedStream(statement, params, options) {
    options = control.normalize(options || {}, 'MySQL prepared stream');
    if (!this.connected || !this.socket || this.ended) throw new Error('MySQL connection is not ready');
    if (this._queryState) throw new Error('MySQL connection already has an active operation');
    if (options.signal && options.signal.aborted) throw (options.signal.reason || new Error('MySQL prepared stream aborted'));

    var limits = limitsFor(this, options);
    var highWaterMark = positiveInteger(options.highWaterMark, this.streamHighWaterMark, 'MySQL result stream highWaterMark');
    var state = { kind: 'stream-execute', phase: 'start', statement: statement, columnCount: 0, fields: [], cleanup: null };
    initializeLimits(state, limits);
    var stream = new ResultStream(this, state, { highWaterMark: highWaterMark });
    state.stream = stream;
    state.reject = function (error) { if (!stream.destroyed) stream.destroy(error); };
    this._queryState = state;
    this._sequence = 0;

    var self = this;
    var timer = null;
    var abortHandler = null;
    if (options.timeout !== undefined) {
      timer = setTimeout(function () { self.destroy(new Error('MySQL prepared stream timed out')); }, options.timeout);
      if (timer.unref) timer.unref();
    }
    if (options.signal) {
      abortHandler = function () { self.destroy(options.signal.reason || new Error('MySQL prepared stream aborted')); };
      options.signal.addEventListener('abort', abortHandler, { once: true });
    }
    state.cleanup = function () {
      if (timer) clearTimeout(timer);
      if (abortHandler) options.signal.removeEventListener('abort', abortHandler);
    };

    try {
      this._write(prepared.encodeExecute(statement.id, params));
    } catch (error) {
      this._queryState = null;
      cleanupState(state);
      stream.destroy(error);
    }
    return stream;
  };

  Connection.prototype._handlePreparedStreamPacket = function _handlePreparedStreamPacket(payload, state) {
    var limitError = this._limitPayload(payload, state);
    if (limitError) { this.destroy(limitError); return; }

    if (payload[0] === 0xff) {
      var errorInfo = server.decodeErrorPacket(payload);
      this._finishStream(state, new MySqlError(errorInfo.message, errorInfo));
      return;
    }
    if (state.phase === 'start' && payload[0] === 0x00) {
      var ok = server.decodeOkPacket(payload);
      this._finishStream(state, null, { command: ok });
      return;
    }
    if (state.phase === 'start') {
      var reader = new PacketReader(payload);
      state.columnCount = Number(reader.lengthEncodedInteger());
      state.phase = 'columns';
      return;
    }
    if (state.phase === 'columns') {
      state.fields.push(server.decodeColumnDefinition41(payload));
      if (state.fields.length === state.columnCount) state.phase = 'columnTerminator';
      return;
    }
    if (state.phase === 'columnTerminator') {
      if (payload[0] !== 0xfe || payload.length >= 9) {
        this.destroy(new Error('Expected MySQL EOF after prepared stream column definitions'));
        return;
      }
      server.decodeEofPacket(payload);
      state.stream._setFields(state.fields);
      state.phase = 'rows';
      return;
    }
    if (state.phase === 'rows') {
      if (payload[0] === 0xfe && payload.length < 9) {
        var eof = server.decodeEofPacket(payload);
        this._finishStream(state, null, { serverStatus: eof.statusFlags, warningCount: eof.warnings });
        return;
      }
      limitError = this._limitRow(payload, state);
      if (limitError) { this.destroy(limitError); return; }
      state.stream._pushRow(prepared.decodeBinaryRow(payload, state.fields), payload.length);
    }
  };

  var originalHandle = Connection.prototype._handleQueryPacket;
  Connection.prototype._handleQueryPacket = function _handleQueryPacket(payload) {
    var state = this._queryState;
    if (state && state.kind === 'stream-execute') return this._handlePreparedStreamPacket(payload, state);
    return originalHandle.call(this, payload);
  };
}

exports.install = install;
