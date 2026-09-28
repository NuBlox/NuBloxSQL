'use strict';

var CODES = Object.freeze({
  CONNECTION_NOT_READY: 'NUBLOX_MYSQL_CONNECTION_NOT_READY',
  CONNECTION_CLOSED: 'NUBLOX_MYSQL_CONNECTION_CLOSED',
  ACTIVE_OPERATION: 'NUBLOX_MYSQL_ACTIVE_OPERATION',
  TIMEOUT: 'NUBLOX_MYSQL_TIMEOUT',
  ABORTED: 'NUBLOX_MYSQL_ABORTED',
  POOL_ENDED: 'NUBLOX_MYSQL_POOL_ENDED',
  POOL_QUEUE_LIMIT: 'NUBLOX_MYSQL_POOL_QUEUE_LIMIT',
  POOL_ACQUIRE_TIMEOUT: 'NUBLOX_MYSQL_POOL_ACQUIRE_TIMEOUT',
  POOL_ACQUIRE_ABORTED: 'NUBLOX_MYSQL_POOL_ACQUIRE_ABORTED',
  POOL_CONNECTION_OWNERSHIP: 'NUBLOX_MYSQL_POOL_CONNECTION_OWNERSHIP',
  POOL_CONNECTION_BUSY: 'NUBLOX_MYSQL_POOL_CONNECTION_BUSY',
  TRANSACTION_STATE: 'NUBLOX_MYSQL_TRANSACTION_STATE',
  OPERATION_STATE: 'NUBLOX_MYSQL_OPERATION_STATE'
});

function MySqlClientError(message, details) {
  details = details || {};
  Error.call(this, message);
  this.name = 'MySqlClientError';
  this.message = message;
  this.code = details.code || CODES.OPERATION_STATE;
  this.category = details.category || 'state';
  this.retryable = details.retryable === true;
  this.sqlState = null;
  if (details.cause !== undefined) this.cause = details.cause;
  if (Error.captureStackTrace) Error.captureStackTrace(this, MySqlClientError);
}
MySqlClientError.prototype = Object.create(Error.prototype);
MySqlClientError.prototype.constructor = MySqlClientError;

function classify(error, operation, aborted) {
  if (!error || error.name === 'MySqlError' || error.name === 'MySqlResultLimitError' || error.name === 'MySqlClientError') return error;
  if (error instanceof TypeError || error instanceof RangeError) return error;

  var message = error.message || String(error);
  var lower = message.toLowerCase();
  var details = { cause: error, code: CODES.OPERATION_STATE, category: 'state', retryable: false };

  if (aborted || lower.indexOf('aborted') !== -1 || error.name === 'AbortError') {
    details.code = operation === 'getConnection' ? CODES.POOL_ACQUIRE_ABORTED : CODES.ABORTED;
    details.category = 'cancelled';
  } else if (lower.indexOf('timed out') !== -1 || lower.indexOf('timeout') !== -1) {
    details.code = operation === 'getConnection' ? CODES.POOL_ACQUIRE_TIMEOUT : CODES.TIMEOUT;
    details.category = 'timeout';
    details.retryable = true;
  } else if (lower.indexOf('pool has ended') !== -1) {
    details.code = CODES.POOL_ENDED;
    details.category = 'connection';
  } else if (lower.indexOf('queue limit') !== -1) {
    details.code = CODES.POOL_QUEUE_LIMIT;
    details.category = 'resource-limit';
    details.retryable = true;
  } else if (lower.indexOf('does not belong to this pool') !== -1) {
    details.code = CODES.POOL_CONNECTION_OWNERSHIP;
  } else if (lower.indexOf('cannot release') !== -1) {
    details.code = CODES.POOL_CONNECTION_BUSY;
  } else if (lower.indexOf('transaction') !== -1 || lower.indexOf('savepoint') !== -1) {
    details.code = CODES.TRANSACTION_STATE;
  } else if (lower.indexOf('already has an active') !== -1 || lower.indexOf('another operation is active') !== -1) {
    details.code = CODES.ACTIVE_OPERATION;
  } else if (lower.indexOf('not ready') !== -1) {
    details.code = CODES.CONNECTION_NOT_READY;
    details.category = 'connection';
  } else if (lower.indexOf('closed unexpectedly') !== -1 || lower.indexOf('has ended') !== -1 || lower.indexOf('socket is not writable') !== -1) {
    details.code = CODES.CONNECTION_CLOSED;
    details.category = 'connection';
    details.retryable = true;
  }

  return new MySqlClientError(message, details);
}

function isPromise(value) {
  return value && typeof value.then === 'function';
}

function operationSignal(name, args) {
  var options = null;
  if (name === 'connect') options = this && this.config;
  else if (name === 'query' || name === 'queryStream' || name === 'prepare' || name === 'savepoint' || name === 'rollbackToSavepoint' || name === 'releaseSavepoint') options = args[1];
  else if (name === 'execute') options = args[2] || args[1];
  else if (name === 'withTransaction') options = args[1];
  else options = args[0];
  return options && options.signal ? options.signal : null;
}

function wrapMethod(prototype, name) {
  if (!prototype || typeof prototype[name] !== 'function') return;
  var original = prototype[name];
  if (original._nubloxErrorModel) return;

  function errorModelMethod() {
    var signal = operationSignal.call(this, name, arguments);
    var result;
    try {
      result = original.apply(this, arguments);
    } catch (error) {
      throw classify(error, name, Boolean(signal && signal.aborted));
    }
    if (isPromise(result)) {
      return result.then(function (value) { return value; }, function (error) {
        throw classify(error, name, Boolean(signal && signal.aborted));
      });
    }
    return result;
  }
  Object.defineProperty(errorModelMethod, '_nubloxErrorModel', { value: true });
  prototype[name] = errorModelMethod;
}

function wrapStreamDestroy(ResultStream) {
  if (!ResultStream || typeof ResultStream.prototype.destroy !== 'function') return;
  var original = ResultStream.prototype.destroy;
  if (original._nubloxErrorModel) return;

  function errorModelDestroy(error) {
    return original.call(this, error ? classify(error, 'queryStream', false) : error);
  }
  Object.defineProperty(errorModelDestroy, '_nubloxErrorModel', { value: true });
  ResultStream.prototype.destroy = errorModelDestroy;
}

function install(runtime, pool, ResultStream) {
  var Connection = runtime && runtime.Connection;
  var PreparedStatement = runtime && runtime.PreparedStatement;
  var Pool = pool && pool.Pool;

  if (Connection) {
    ['connect', 'query', 'queryStream', 'prepare', 'resetSession', 'beginTransaction', 'commit', 'rollback', 'withTransaction', 'savepoint', 'rollbackToSavepoint', 'releaseSavepoint', 'end'].forEach(function (name) {
      wrapMethod(Connection.prototype, name);
    });
  }
  if (PreparedStatement) {
    ['execute', 'reset', 'close'].forEach(function (name) { wrapMethod(PreparedStatement.prototype, name); });
  }
  if (Pool) {
    ['getConnection', 'releaseConnection', 'query', 'queryStream', 'execute', 'withTransaction', 'end'].forEach(function (name) {
      wrapMethod(Pool.prototype, name);
    });
  }
  wrapStreamDestroy(ResultStream);
}

exports.CODES = CODES;
exports.MySqlClientError = MySqlClientError;
exports.classify = classify;
exports.install = install;
