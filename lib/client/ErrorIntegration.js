'use strict';

var errors = require('./Error');

function isPlainApplicationCause(error) {
  if (!error || error.name !== 'MySqlClientError') return false;
  if (error.code !== 'NUBLOX_MYSQL_OPERATION_STATE' || error.category !== 'state') return false;
  var cause = error.cause;
  if (!(cause instanceof Error)) return false;
  if (cause.name !== 'Error') return false;
  if (cause.code !== undefined || cause.category !== undefined || cause.sqlState !== undefined) return false;
  return true;
}

function operationOptions(args) {
  return args && args.length > 1 && args[1] && typeof args[1] === 'object' ? args[1] : null;
}

function signalCancellationError(receiver, method, error, args) {
  var options = operationOptions(args);
  var signal = options && options.signal;
  if (!signal || !signal.aborted) return null;

  var code = String(error && error.code || '');
  var name = String(error && error.name || '');
  var message = String(error && error.message || '').toLowerCase();
  var signalReason = signal.reason;
  var causedBySignal = error === signalReason || name === 'AbortError' || /ABORT|CANCEL/.test(code) || message.indexOf('aborted') >= 0 || message.indexOf('cancelled') >= 0;
  if (!causedBySignal) return null;

  return new errors.NuBloxSqlError(error && error.message ? error.message : 'NuBloxSQL operation cancelled', {
    category: errors.CATEGORIES.CANCELLED,
    dialect: receiver.dialect,
    operation: method,
    retryable: false,
    nativeCode: error && error.code !== undefined ? error.code : null,
    native: error || signalReason || null,
    cause: error || signalReason
  });
}

function preserveControlIntent(error, receiver, method, args) {
  if (!(error instanceof errors.NuBloxSqlError) || error.category !== errors.CATEGORIES.CANCELLED) return error;
  var options = operationOptions(args);
  if (!options) return error;
  if (options.signal && options.signal.aborted) return error;
  if (options.timeout === undefined && options.deadline === undefined) return error;

  return new errors.NuBloxSqlError(error.message, {
    category: errors.CATEGORIES.TIMEOUT,
    dialect: receiver.dialect,
    operation: method,
    retryable: true,
    sqlState: error.sqlState,
    nativeCode: error.nativeCode,
    native: error.native,
    cause: error.cause === undefined ? error : error.cause
  });
}

function mapError(receiver, method, error, args) {
  if (error instanceof errors.NuBloxSqlError) return preserveControlIntent(error, receiver, method, args);

  var signalError = signalCancellationError(receiver, method, error, args);
  if (signalError) return signalError;

  if (method === 'transaction' && isPlainApplicationCause(error)) return error.cause;

  var message = String(error && error.message || '');
  var match;
  if (method === 'one' && (match = message.match(/expected exactly one row, received (\d+)/))) {
    return errors.cardinalityError(receiver.dialect, 'one', 'exactly one row', Number(match[1]));
  }
  if (message.indexOf('does not support prepared statements') >= 0) {
    return errors.unsupportedError(receiver.dialect, 'prepared statements');
  }
  if (message.indexOf('does not support transactions') >= 0) {
    return errors.unsupportedError(receiver.dialect, 'transactions');
  }
  return preserveControlIntent(errors.normalizeError(receiver.dialect, error, method), receiver, method, args);
}

function wrap(prototype, method) {
  if (!prototype || typeof prototype[method] !== 'function') return;
  var original = prototype[method];
  if (original._nubloxPortableErrorModel) return;

  function portableErrorMethod() {
    var self = this;
    var args = Array.prototype.slice.call(arguments);
    var result;
    try {
      result = original.apply(this, args);
    } catch (error) {
      throw mapError(this, method, error, args);
    }
    if (result && typeof result.then === 'function') {
      return result.then(function (value) { return value; }, function (error) {
        throw mapError(self, method, error, args);
      });
    }
    return result;
  }

  Object.defineProperty(portableErrorMethod, '_nubloxPortableErrorModel', { value: true });
  prototype[method] = portableErrorMethod;
}

function install(clientApi) {
  ['query', 'all', 'one', 'execute', 'prepare', 'transaction', 'diagnose', 'close'].forEach(function (method) {
    wrap(clientApi.Client && clientApi.Client.prototype, method);
  });
  ['query', 'all', 'one', 'execute', 'close'].forEach(function (method) {
    wrap(clientApi.PreparedClientStatement && clientApi.PreparedClientStatement.prototype, method);
  });
}

exports.install = install;
exports.mapError = mapError;
