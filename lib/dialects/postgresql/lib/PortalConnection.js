'use strict';

var transaction = require('./TransactionConnection');
var frontend = require('./protocol/FrontendMessage');
var base = require('./Connection');
var limits = require('./ResultLimits');
var types = require('./TypeDecoder');

var PreparedStatement = transaction.PreparedStatement;
var originalStatementClose = PreparedStatement.prototype.close;
var baseCommit = transaction.Connection.prototype.commit;
var baseRollback = transaction.Connection.prototype.rollback;
var baseResetSession = transaction.Connection.prototype.resetSession;
var baseStartOperation = transaction.Connection.prototype._startOperation;

function positiveInteger(value, fallback, name) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0 || value > 0xffffffff) throw new RangeError(name + ' must be a positive unsigned 32-bit integer');
  return value;
}

function applyCancelReason(state) {
  if (!state || !state.cancelReason) return;
  if (state.error && state.cancelReason.cause === undefined) state.cancelReason.cause = state.error;
  state.error = state.cancelReason;
}

function PortalCursor(connection, statement, parameters, options) {
  options = options || {};
  this.connection = connection;
  this.statement = statement;
  this.name = options.name || 'nublox_portal_' + (++connection._portalCounter);
  this.batchSize = positiveInteger(options.batchSize, 128, 'PostgreSQL portal batchSize');
  this.parameters = parameters;
  this.fields = statement.fields || [];
  this.closed = false;
  this.done = false;
  this._bound = false;
  statement._activeCursors = (statement._activeCursors || 0) + 1;
  connection._activePortals.add(this);
}

PortalCursor.prototype._invalidate = function _invalidate() {
  if (this.closed) return;
  this.closed = true;
  this.done = true;
  this.connection._activePortals.delete(this);
  if (this.statement._activeCursors > 0) this.statement._activeCursors -= 1;
};

PortalCursor.prototype.fetch = function fetch(options) {
  if (this.done) return Promise.resolve({ rows: [], fields: this.fields, done: true, command: '', rowCount: 0 });
  if (this.closed) return Promise.reject(new Error('PostgreSQL portal cursor is closed'));
  return this.connection._fetchPortal(this, options || {});
};

PortalCursor.prototype.close = function close(options) {
  if (this.closed) return Promise.resolve();
  var self = this;
  return this.connection._closePortal(this, options || {}).then(function () { self._invalidate(); });
};

PortalCursor.prototype[Symbol.asyncIterator] = function iterator() {
  var cursor = this;
  var rows = [];
  var index = 0;
  return {
    next: async function next() {
      while (index >= rows.length) {
        if (cursor.done) return { done: true, value: undefined };
        var batch = await cursor.fetch();
        rows = batch.rows;
        index = 0;
        if (!rows.length && batch.done) return { done: true, value: undefined };
      }
      return { done: false, value: rows[index++] };
    },
    return: async function closeEarly() {
      await cursor.close();
      return { done: true, value: undefined };
    }
  };
};

PreparedStatement.prototype.openCursor = function openCursor(parameters, options) {
  if (this.closed) throw new Error('PostgreSQL prepared statement is closed');
  parameters = parameters || [];
  if (!Array.isArray(parameters)) throw new TypeError('PostgreSQL portal parameters must be an array');
  if (parameters.length !== this.parameterTypeOids.length) throw new RangeError('PostgreSQL prepared statement expects ' + this.parameterTypeOids.length + ' parameter(s), received ' + parameters.length);
  if (this.connection.transactionStatus !== 'T') throw new Error('PostgreSQL server-side portals require an active transaction');
  return new PortalCursor(this.connection, this, parameters, options || {});
};

PreparedStatement.prototype.close = function close(options) {
  if (this._activeCursors > 0) return Promise.reject(new Error('Cannot close PostgreSQL prepared statement while portal cursors are active'));
  return originalStatementClose.call(this, options);
};

function Connection(config) {
  transaction.Connection.call(this, config);
  config = config || {};
  this._portalCounter = 0;
  this._activePortals = new Set();
  var defaults = limits.create(config, {});
  this.maxRows = defaults.maxRows;
  this.maxResultBytes = defaults.maxResultBytes;
  this.maxRowBytes = defaults.maxRowBytes;
}
Connection.prototype = Object.create(transaction.Connection.prototype);
Connection.prototype.constructor = Connection;

Connection.prototype._startOperation = function _startOperation(state, messages, options) {
  state._resultLimits = limits.create({
    maxRows: this.maxRows,
    maxResultBytes: this.maxResultBytes,
    maxRowBytes: this.maxRowBytes
  }, options || {});
  return baseStartOperation.call(this, state, messages, options || {});
};

Connection.prototype._decodeRow = function _decodeRow(message, state) {
  limits.observeRow(state, message);
  var row = Object.create(null);
  var fields = state.fields || [];
  for (var i = 0; i < message.values.length; i++) {
    var field = fields[i] || { name: String(i) };
    row[field.name] = types.decodeText(field, message.values[i]);
  }
  state.rows.push(row);
};

Connection.prototype._invalidatePortals = function _invalidatePortals() {
  Array.from(this._activePortals).forEach(function (cursor) { cursor._invalidate(); });
  this._activePortals.clear();
};

Connection.prototype.commit = async function commit(options) {
  var result = await baseCommit.call(this, options || {});
  this._invalidatePortals();
  return result;
};

Connection.prototype.rollback = async function rollback(options) {
  var result = await baseRollback.call(this, options || {});
  this._invalidatePortals();
  return result;
};

Connection.prototype.resetSession = async function resetSession(options) {
  var result = await baseResetSession.call(this, options || {});
  this._invalidatePortals();
  return result;
};

Connection.prototype._fetchPortal = function _fetchPortal(cursor, options) {
  if (!this._activePortals.has(cursor) || cursor.closed) return Promise.reject(new Error('PostgreSQL portal cursor is no longer active'));
  if (this.transactionStatus !== 'T') return Promise.reject(new Error('PostgreSQL server-side portals require an active transaction'));
  var encoded = cursor.parameters.map(base.encodeTextParameter);
  var state = {
    kind: 'portal-fetch',
    cursor: cursor,
    rows: [],
    fields: cursor.fields || [],
    command: '',
    rowCount: null,
    suspended: false,
    error: null
  };
  var messages = [];
  try {
    if (!cursor._bound) {
      messages.push(frontend.encodeBind({ statement: cursor.statement.name, portal: cursor.name, parameters: encoded }));
      messages.push(frontend.encodeDescribe('P', cursor.name));
    }
    messages.push(frontend.encodeExecute(cursor.name, cursor.batchSize));
    messages.push(frontend.encodeSync());
  } catch (error) { return Promise.reject(error); }
  return this._startOperation(state, messages, options || {});
};

Connection.prototype._closePortal = function _closePortal(cursor, options) {
  if (!cursor._bound) return Promise.resolve();
  var state = { kind: 'portal-close', cursor: cursor, error: null, closeComplete: false };
  return this._startOperation(state, [frontend.encodeClose('P', cursor.name), frontend.encodeSync()], options || {});
};

Connection.prototype._finishOperation = function _finishOperation(state) {
  if (state && state.kind === 'portal-fetch') {
    if (this._currentQuery !== state) return;
    this._currentQuery = null;
    if (state.cleanup) state.cleanup();
    applyCancelReason(state);
    if (state.error) { state.reject(state.error); return; }
    state.cursor._bound = true;
    state.cursor.fields = state.fields || [];
    state.cursor.done = !state.suspended;
    state.resolve({
      rows: state.rows,
      fields: state.cursor.fields,
      done: state.cursor.done,
      command: state.command || '',
      rowCount: state.rowCount
    });
    return;
  }
  if (state && state.kind === 'portal-close') {
    if (this._currentQuery !== state) return;
    this._currentQuery = null;
    if (state.cleanup) state.cleanup();
    applyCancelReason(state);
    if (state.error) state.reject(state.error);
    else state.resolve();
    return;
  }
  return transaction.Connection.prototype._finishOperation.call(this, state);
};

var baseHandleMessage = transaction.Connection.prototype._handleMessage;
Connection.prototype._handleMessage = function _handleMessage(message) {
  var operation = this._currentQuery;
  if (!operation || (operation.kind !== 'portal-fetch' && operation.kind !== 'portal-close')) return baseHandleMessage.call(this, message);

  if (message.type === 'authentication' || message.type === 'parameterStatus' || message.type === 'backendKeyData' || message.type === 'noticeResponse' || message.type === 'errorResponse') {
    return baseHandleMessage.call(this, message);
  }

  if (operation.kind === 'portal-fetch') {
    if (message.type === 'bindComplete') { operation.bindComplete = true; return; }
    if (message.type === 'rowDescription') { operation.fields = message.fields; return; }
    if (message.type === 'noData') { operation.fields = []; return; }
    if (message.type === 'dataRow') { this._decodeRow(message, operation); return; }
    if (message.type === 'portalSuspended') { operation.suspended = true; return; }
    if (message.type === 'commandComplete') {
      operation.command = message.tag;
      var parts = String(message.tag || '').trim().split(/\s+/);
      var count = Number(parts[parts.length - 1]);
      operation.rowCount = Number.isSafeInteger(count) ? count : null;
      return;
    }
  }
  if (operation.kind === 'portal-close' && message.type === 'closeComplete') { operation.closeComplete = true; return; }
  if (message.type === 'readyForQuery') {
    this.transactionStatus = message.transactionStatus;
    this._finishOperation(operation);
    return;
  }
  return baseHandleMessage.call(this, message);
};

exports.Connection = Connection;
exports.PreparedStatement = PreparedStatement;
exports.PortalCursor = PortalCursor;
exports.PostgreSqlError = transaction.PostgreSqlError;
exports.PostgreSqlCancellationError = transaction.PostgreSqlCancellationError;
exports.PostgreSqlResultLimitError = limits.PostgreSqlResultLimitError;
exports.DEFAULT_RESULT_LIMITS = limits.DEFAULTS;
exports.TYPE_OIDS = types.OID;
