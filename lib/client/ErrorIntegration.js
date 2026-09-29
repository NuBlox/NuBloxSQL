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

function mapError(receiver, method, error) {
  if (error instanceof errors.NuBloxSqlError) return error;

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
  return errors.normalizeError(receiver.dialect, error, method);
}

function wrap(prototype, method) {
  if (!prototype || typeof prototype[method] !== 'function') return;
  var original = prototype[method];
  if (original._nubloxPortableErrorModel) return;

  function portableErrorMethod() {
    var self = this;
    var result;
    try {
      result = original.apply(this, arguments);
    } catch (error) {
      throw mapError(this, method, error);
    }
    if (result && typeof result.then === 'function') {
      return result.then(function (value) { return value; }, function (error) {
        throw mapError(self, method, error);
      });
    }
    return result;
  }

  Object.defineProperty(portableErrorMethod, '_nubloxPortableErrorModel', { value: true });
  prototype[method] = portableErrorMethod;
}

function install(clientApi) {
  ['query', 'all', 'one', 'execute', 'prepare', 'transaction', 'close'].forEach(function (method) {
    wrap(clientApi.Client && clientApi.Client.prototype, method);
  });
  ['query', 'all', 'one', 'execute', 'close'].forEach(function (method) {
    wrap(clientApi.PreparedClientStatement && clientApi.PreparedClientStatement.prototype, method);
  });
}

exports.install = install;
exports.mapError = mapError;
