'use strict';

var session = require('./SessionConnection');
var PacketReader = require('./protocol/PacketReader').PacketReader;
var client = require('./protocol/ClientPackets');
var server = require('./protocol/ServerPackets');
var ResultStream = require('./ResultStream').ResultStream;

var SERVER_STATUS_MORE_RESULTS_EXISTS = 0x0008;
var DEFAULT_MAX_ROWS = 100000;
var DEFAULT_MAX_RESULT_BYTES = 64 * 1024 * 1024;
var DEFAULT_MAX_ROW_BYTES = 16 * 1024 * 1024;
var DEFAULT_STREAM_HIGH_WATER_MARK = 16;

function positiveInteger(value, fallback, name) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(name + ' must be a positive integer');
  return value;
}

function MySqlResultLimitError(message, details) {
  RangeError.call(this, message);
  this.name = 'MySqlResultLimitError';
  this.message = message;
  this.code = details.code;
  this.limit = details.limit;
  this.observed = details.observed;
  if (Error.captureStackTrace) Error.captureStackTrace(this, MySqlResultLimitError);
}
MySqlResultLimitError.prototype = Object.create(RangeError.prototype);
MySqlResultLimitError.prototype.constructor = MySqlResultLimitError;

function limitsFor(connection, options) {
  options = options || {};
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

function Connection(config) {
  session.Connection.call(this, config);
  config = config || {};
  this.maxRows = positiveInteger(config.maxRows, DEFAULT_MAX_ROWS, 'MySQL maxRows');
  this.maxResultBytes = positiveInteger(config.maxResultBytes, DEFAULT_MAX_RESULT_BYTES, 'MySQL maxResultBytes');
  this.maxRowBytes = positiveInteger(config.maxRowBytes, DEFAULT_MAX_ROW_BYTES, 'MySQL maxRowBytes');
  this.streamHighWaterMark = positiveInteger(config.streamHighWaterMark, DEFAULT_STREAM_HIGH_WATER_MARK, 'MySQL streamHighWaterMark');
}
Connection.prototype = Object.create(session.Connection.prototype);
Connection.prototype.constructor = Connection;

Connection.prototype._limitPayload = function _limitPayload(payload, state) {
  state.resultBytes += payload.length;
  if (state.resultBytes > state.maxResultBytes) {
    return new MySqlResultLimitError('MySQL result exceeded maxResultBytes', {
      code: 'NUBLOX_MYSQL_MAX_RESULT_BYTES',
      limit: state.maxResultBytes,
      observed: state.resultBytes
    });
  }
  return null;
};

Connection.prototype._limitRow = function _limitRow(payload, state) {
  if (payload.length > state.maxRowBytes) {
    return new MySqlResultLimitError('MySQL row exceeded maxRowBytes', {
      code: 'NUBLOX_MYSQL_MAX_ROW_BYTES',
      limit: state.maxRowBytes,
      observed: payload.length
    });
  }
  var nextRowCount = state.rowCount + 1;
  if (nextRowCount > state.maxRows) {
    return new MySqlResultLimitError('MySQL result exceeded maxRows', {
      code: 'NUBLOX_MYSQL_MAX_ROWS',
      limit: state.maxRows,
      observed: nextRowCount
    });
  }
  state.rowCount = nextRowCount;
  return null;
};

var baseQuery = session.Connection.prototype.query;
Connection.prototype.query = function query(sql, options) {
  var result;
  try {
    var limits = limitsFor(this, options || {});
    result = baseQuery.call(this, sql, options || {});
    if (this._queryState && !this._queryState.kind) initializeLimits(this._queryState, limits);
  } catch (error) {
    return Promise.reject(error);
  }
  return result;
};

Connection.prototype._finishStream = function _finishStream(state, error, result) {
  if (this._queryState !== state) return;
  this._queryState = null;
  cleanupState(state);
  if (error) {
    state.stream.destroy(error);
    return;
  }
  if (result && result.command) {
    state.stream._completeCommand(result.command);
    return;
  }
  state.stream._complete(result.serverStatus, result.warningCount);
};

Connection.prototype.queryStream = function queryStream(sql, options) {
  options = options || {};
  if (!this.connected || !this.socket || this.ended) throw new Error('MySQL connection is not ready');
  if (this._queryState) throw new Error('MySQL connection already has an active operation');
  if (options.timeout !== undefined && (!Number.isFinite(options.timeout) || options.timeout <= 0)) throw new RangeError('MySQL query timeout must be a positive number');
  if (options.signal && options.signal.aborted) throw (options.signal.reason || new Error('MySQL query aborted'));

  var limits = limitsFor(this, options);
  var highWaterMark = positiveInteger(options.highWaterMark, this.streamHighWaterMark, 'MySQL result stream highWaterMark');
  var state = { kind: 'stream-query', phase: 'start', columnCount: 0, fields: [], cleanup: null };
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
    timer = setTimeout(function () { self.destroy(new Error('MySQL query timed out')); }, options.timeout);
    if (timer.unref) timer.unref();
  }
  if (options.signal) {
    abortHandler = function () { self.destroy(options.signal.reason || new Error('MySQL query aborted')); };
    options.signal.addEventListener('abort', abortHandler, { once: true });
  }
  state.cleanup = function () {
    if (timer) clearTimeout(timer);
    if (abortHandler) options.signal.removeEventListener('abort', abortHandler);
  };

  try {
    this._write(client.encodeQuery(sql));
  } catch (error) {
    this._queryState = null;
    cleanupState(state);
    stream.destroy(error);
  }
  return stream;
};

Connection.prototype._handleStreamQueryPacket = function _handleStreamQueryPacket(payload, state) {
  var limitError = this._limitPayload(payload, state);
  if (limitError) {
    this.destroy(limitError);
    return;
  }
  if (payload[0] === 0xff) {
    var errorInfo = server.decodeErrorPacket(payload);
    this._finishStream(state, new session.Connection.prototype.constructor.MySqlError(errorInfo.message, errorInfo));
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
      this.destroy(new Error('Expected MySQL EOF after column definitions'));
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
      if (eof.statusFlags & SERVER_STATUS_MORE_RESULTS_EXISTS) {
        this.destroy(new Error('Multiple MySQL result sets are not implemented in clean-room streaming runtime yet'));
        return;
      }
      this._finishStream(state, null, { serverStatus: eof.statusFlags, warningCount: eof.warnings });
      return;
    }
    limitError = this._limitRow(payload, state);
    if (limitError) {
      this.destroy(limitError);
      return;
    }
    state.stream._pushRow(server.decodeTextRow(payload, state.fields), payload.length);
  }
};

var baseHandleQueryPacket = session.Connection.prototype._handleQueryPacket;
Connection.prototype._handleQueryPacket = function _handleQueryPacket(payload) {
  var state = this._queryState;
  if (!state) return;
  if (state.kind === 'stream-query') return this._handleStreamQueryPacket(payload, state);
  if (!state.kind && state.maxResultBytes) {
    var limitError = this._limitPayload(payload, state);
    if (limitError) {
      this.destroy(limitError);
      return;
    }
    if (state.phase === 'rows' && !(payload[0] === 0xfe && payload.length < 9)) {
      limitError = this._limitRow(payload, state);
      if (limitError) {
        this.destroy(limitError);
        return;
      }
    }
  }
  return baseHandleQueryPacket.call(this, payload);
};

exports.Connection = Connection;
exports.PreparedStatement = session.PreparedStatement;
exports.ISOLATION_LEVELS = session.ISOLATION_LEVELS;
exports.MySqlResultLimitError = MySqlResultLimitError;
exports.DEFAULT_LIMITS = Object.freeze({
  maxRows: DEFAULT_MAX_ROWS,
  maxResultBytes: DEFAULT_MAX_RESULT_BYTES,
  maxRowBytes: DEFAULT_MAX_ROW_BYTES,
  streamHighWaterMark: DEFAULT_STREAM_HIGH_WATER_MARK
});
