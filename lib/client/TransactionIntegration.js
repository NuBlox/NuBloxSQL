'use strict';

function assertSavepointName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_$]*$/.test(name)) {
    throw new TypeError('NuBloxSQL savepoint name must start with a letter or underscore and contain only letters, digits, underscore or dollar');
  }
  return name;
}

function unsupported(client, feature) {
  var error = new Error('NuBloxSQL dialect "' + client.dialect + '" does not support ' + feature);
  error.code = 'NUBLOXSQL_UNSUPPORTED';
  error.category = 'unsupported';
  return error;
}

function savepoint(client, name, options) {
  name = assertSavepointName(name);
  if (!client.supports('savepoints')) return Promise.reject(unsupported(client, 'savepoints'));
  var target = client._target;
  if (client.dialect === 'sqlite') return Promise.resolve(target.savepoint(name));
  if (typeof target.savepoint !== 'function') return Promise.reject(unsupported(client, 'savepoints'));
  return target.savepoint(name, options || {});
}

function rollbackTo(client, name, options) {
  name = assertSavepointName(name);
  if (!client.supports('savepoints')) return Promise.reject(unsupported(client, 'savepoints'));
  var target = client._target;
  if (client.dialect === 'sqlite') return Promise.resolve(target.rollbackTo(name));
  if (typeof target.rollbackToSavepoint !== 'function') return Promise.reject(unsupported(client, 'savepoints'));
  return target.rollbackToSavepoint(name, options || {});
}

function releaseSavepoint(client, name, options) {
  name = assertSavepointName(name);
  if (!client.supports('savepoints')) return Promise.reject(unsupported(client, 'savepoints'));
  var target = client._target;
  if (client.dialect === 'sqlite') return Promise.resolve(target.release(name));
  if (typeof target.releaseSavepoint !== 'function') return Promise.reject(unsupported(client, 'savepoints'));
  return target.releaseSavepoint(name, options || {});
}

function normalizeRetryOptions(options) {
  options = options || {};
  var retries = options.retries === undefined ? 0 : options.retries;
  if (!Number.isInteger(retries) || retries < 0 || retries > 100) throw new RangeError('NuBloxSQL transaction retries must be an integer between 0 and 100');
  var retryDelayMs = options.retryDelayMs === undefined ? 0 : options.retryDelayMs;
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) throw new RangeError('NuBloxSQL transaction retryDelayMs must be a non-negative number');
  return { retries: retries, retryDelayMs: retryDelayMs };
}

function delay(ms) {
  if (!ms) return Promise.resolve();
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function install(clientApi) {
  if (!clientApi || !clientApi.Client) return;
  var proto = clientApi.Client.prototype;
  if (proto._nubloxAdvancedTransactionsInstalled) return;

  proto.savepoint = function clientSavepoint(name, options) { return savepoint(this, name, options); };
  proto.rollbackTo = function clientRollbackTo(name, options) { return rollbackTo(this, name, options); };
  proto.releaseSavepoint = function clientReleaseSavepoint(name, options) { return releaseSavepoint(this, name, options); };

  var originalTransaction = proto.transaction;
  proto.transaction = async function transactionWithRetry(fn, options) {
    var policy = normalizeRetryOptions(options);
    var attempt = 0;
    while (true) {
      try {
        return await originalTransaction.call(this, fn, options || {});
      } catch (error) {
        if (attempt >= policy.retries || !error || error.retryable !== true) throw error;
        attempt += 1;
        await delay(policy.retryDelayMs);
      }
    }
  };

  Object.defineProperty(proto, '_nubloxAdvancedTransactionsInstalled', { value: true });
}

exports.install = install;
exports.assertSavepointName = assertSavepointName;
exports.normalizeRetryOptions = normalizeRetryOptions;
