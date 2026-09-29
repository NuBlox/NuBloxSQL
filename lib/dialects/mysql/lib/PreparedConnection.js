'use strict';

var base = require('./Connection');
var control = require('./OperationControl');
var PacketReader = require('./protocol/PacketReader').PacketReader;
var prepared = require('./protocol/PreparedPackets');
var server = require('./protocol/ServerPackets');

function PreparedStatement(connection, info) {
  this.connection = connection;
  this.id = info.statementId;
  this.parameterCount = info.numParams;
  this.columnCount = info.numColumns;
  this.parameters = info.parameters || [];
  this.columns = info.columns || [];
  this.warningCount = info.warningCount || 0;
  this.closed = false;
}

PreparedStatement.prototype.execute = function execute(params, options) {
  if (this.closed) return Promise.reject(new Error('MySQL prepared statement is closed'));
  params = params || [];
  if (!Array.isArray(params)) return Promise.reject(new TypeError('Prepared statement params must be an array'));
  if (params.length !== this.parameterCount) return Promise.reject(new RangeError('Prepared statement expects ' + this.parameterCount + ' parameter(s), received ' + params.length));
  return this.connection._executePrepared(this, params, options || {});
};

PreparedStatement.prototype.reset = function reset(options) {
  if (this.closed) return Promise.reject(new Error('MySQL prepared statement is closed'));
  return this.connection._resetPrepared(this, options || {});
};

PreparedStatement.prototype.close = function close() {
  if (this.closed) return Promise.resolve();
  this.closed = true;
  return this.connection._closePrepared(this);
};

function Connection(config) {
  base.Connection.call(this, config);
}
Connection.prototype = Object.create(base.Connection.prototype);
Connection.prototype.constructor = Connection;

Connection.prototype._startOperation = function _startOperation(kind, state, payload, options) {
  try { options = control.normalize(options || {}, 'MySQL ' + kind); }
  catch (error) { return Promise.reject(error); }
  if (!this.connected || !this.socket || this.ended) return Promise.reject(new Error('MySQL connection is not ready'));
  if (this._queryState) return Promise.reject(new Error('MySQL connection already has an active operation'));
  if (options.signal && options.signal.aborted) return Promise.reject(options.signal.reason || new Error('MySQL operation aborted'));

  var self = this;
  state.kind = kind;
  state.promise = new Promise(function (resolve, reject) { state.resolve = resolve; state.reject = reject; });
  this._queryState = state;
  this._sequence = 0;

  var timer = null;
  var abortHandler = null;
  if (options.timeout !== undefined) {
    timer = setTimeout(function () { self.destroy(new Error('MySQL operation timed out')); }, options.timeout);
    if (timer.unref) timer.unref();
  }
  if (options.signal) {
    abortHandler = function () { self.destroy(options.signal.reason || new Error('MySQL operation aborted')); };
    options.signal.addEventListener('abort', abortHandler, { once: true });
  }
  function cleanup() {
    if (timer) clearTimeout(timer);
    if (abortHandler) options.signal.removeEventListener('abort', abortHandler);
  }
  state.promise.then(cleanup, cleanup);

  try { this._write(payload); }
  catch (error) {
    this._queryState = null;
    cleanup();
    return Promise.reject(error);
  }
  return state.promise;
};

Connection.prototype.prepare = function prepare(sql, options) {
  var state = { phase: 'start', info: null, parameters: [], columns: [] };
  return this._startOperation('prepare', state, prepared.encodePrepare(sql), options || {});
};

Connection.prototype._executePrepared = function _executePrepared(statement, params, options) {
  var state = { phase: 'start', statement: statement, columnCount: 0, fields: [], rows: [] };
  return this._startOperation('execute', state, prepared.encodeExecute(statement.id, params), options || {});
};

Connection.prototype._resetPrepared = function _resetPrepared(statement, options) {
  var state = { phase: 'start', statement: statement };
  return this._startOperation('reset', state, prepared.encodeReset(statement.id), options || {});
};

Connection.prototype._closePrepared = function _closePrepared(statement) {
  if (!this.connected || !this.socket || this.ended) return Promise.resolve();
  if (this._queryState) return Promise.reject(new Error('Cannot close MySQL prepared statement while another operation is active'));
  this._sequence = 0;
  this._write(prepared.encodeClose(statement.id));
  return Promise.resolve();
};

Connection.prototype._resolvePrepare = function _resolvePrepare(state) {
  var info = state.info;
  var statement = new PreparedStatement(this, {
    statementId: info.statementId,
    numParams: info.numParams,
    numColumns: info.numColumns,
    warningCount: info.warningCount,
    parameters: state.parameters,
    columns: state.columns
  });
  this._queryState = null;
  state.resolve(statement);
};

Connection.prototype._handlePreparePacket = function _handlePreparePacket(payload, state) {
  if (payload[0] === 0xff) {
    var errorInfo = server.decodeErrorPacket(payload);
    this._finishQuery(null, new base.MySqlError(errorInfo.message, errorInfo));
    return;
  }
  if (state.phase === 'start') {
    state.info = prepared.decodePrepareOk(payload);
    if (state.info.numParams) state.phase = 'parameters';
    else if (state.info.numColumns) state.phase = 'columns';
    else this._resolvePrepare(state);
    return;
  }
  if (state.phase === 'parameters') {
    state.parameters.push(server.decodeColumnDefinition41(payload));
    if (state.parameters.length === state.info.numParams) state.phase = 'parameterEof';
    return;
  }
  if (state.phase === 'parameterEof') {
    server.decodeEofPacket(payload);
    if (state.info.numColumns) state.phase = 'columns';
    else this._resolvePrepare(state);
    return;
  }
  if (state.phase === 'columns') {
    state.columns.push(server.decodeColumnDefinition41(payload));
    if (state.columns.length === state.info.numColumns) state.phase = 'columnEof';
    return;
  }
  if (state.phase === 'columnEof') {
    server.decodeEofPacket(payload);
    this._resolvePrepare(state);
  }
};

Connection.prototype._handleExecutePacket = function _handleExecutePacket(payload, state) {
  if (payload[0] === 0xff) {
    var errorInfo = server.decodeErrorPacket(payload);
    this._finishQuery(null, new base.MySqlError(errorInfo.message, errorInfo));
    return;
  }
  if (state.phase === 'start' && payload[0] === 0x00) {
    var ok = server.decodeOkPacket(payload);
    this._finishQuery({ rows: [], fields: [], affectedRows: ok.affectedRows, insertId: ok.lastInsertId, serverStatus: ok.statusFlags, warningCount: ok.warnings });
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
    if (state.fields.length === state.columnCount) state.phase = 'columnEof';
    return;
  }
  if (state.phase === 'columnEof') {
    server.decodeEofPacket(payload);
    state.phase = 'rows';
    return;
  }
  if (state.phase === 'rows') {
    if (payload[0] === 0xfe && payload.length < 9) {
      var eof = server.decodeEofPacket(payload);
      this._finishQuery({ rows: state.rows, fields: state.fields, affectedRows: 0, insertId: 0, serverStatus: eof.statusFlags, warningCount: eof.warnings });
      return;
    }
    state.rows.push(prepared.decodeBinaryRow(payload, state.fields));
  }
};

Connection.prototype._handleResetPacket = function _handleResetPacket(payload, state) {
  if (payload[0] === 0xff) {
    var errorInfo = server.decodeErrorPacket(payload);
    this._finishQuery(null, new base.MySqlError(errorInfo.message, errorInfo));
    return;
  }
  var ok = server.decodeOkPacket(payload);
  this._finishQuery({ serverStatus: ok.statusFlags, warningCount: ok.warnings });
};

var baseHandleQueryPacket = base.Connection.prototype._handleQueryPacket;
Connection.prototype._handleQueryPacket = function _handleQueryPacket(payload) {
  var state = this._queryState;
  if (!state || !state.kind) return baseHandleQueryPacket.call(this, payload);
  if (state.kind === 'prepare') return this._handlePreparePacket(payload, state);
  if (state.kind === 'execute') return this._handleExecutePacket(payload, state);
  if (state.kind === 'reset') return this._handleResetPacket(payload, state);
  return baseHandleQueryPacket.call(this, payload);
};

exports.Connection = Connection;
exports.PreparedStatement = PreparedStatement;
