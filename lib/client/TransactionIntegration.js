'use strict';

var policy = require('./TransactionPolicy');
var errorApi = require('./Error');
var observabilityApi = require('./Observability');

function assertSavepointName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_$]*$/.test(name)) throw new TypeError('NuBloxSQL savepoint name must start with a letter or underscore and contain only letters, digits, underscore or dollar');
  return name;
}

function unsupported(client, feature) {
  return errorApi.unsupportedError(client.dialect, feature);
}

function validateDialectOptions(client, options, nested) {
  if (nested && (options.isolationLevel !== undefined || options.readOnly !== undefined || options.deferrable !== undefined || options.mode !== undefined || (options.retry && options.retry !== false) || options.retries !== undefined)) throw unsupported(client, 'changing transaction characteristics or retry policy inside a nested transaction');
  if (client.dialect === 'sqlite') {
    if (options.isolationLevel !== undefined) throw unsupported(client, 'SQL isolation-level selection');
    if (options.readOnly !== undefined) throw unsupported(client, 'per-transaction read-only mode');
    if (options.deferrable !== undefined) throw unsupported(client, 'DEFERRABLE transaction semantics');
  } else if (client.dialect === 'mysql') {
    if (options.mode !== undefined) throw unsupported(client, 'SQLite transaction modes');
    if (options.deferrable !== undefined) throw unsupported(client, 'DEFERRABLE transaction semantics');
  } else if (client.dialect === 'postgresql') {
    if (options.mode !== undefined) throw unsupported(client, 'SQLite transaction modes');
  } else if (client.dialect === 'sqlserver') {
    if (options.mode !== undefined) throw unsupported(client, 'SQLite transaction modes');
    if (options.readOnly !== undefined) throw unsupported(client, 'per-transaction read-only mode');
    if (options.deferrable !== undefined) throw unsupported(client, 'DEFERRABLE transaction semantics');
  }
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

function install(clientApi) {
  if (!clientApi || !clientApi.Client) return;
  var proto = clientApi.Client.prototype;
  if (proto._nubloxAdvancedTransactionsInstalled) return;

  proto.transactionPolicy = function transactionPolicy() { return policy.describe(this.dialect, this.descriptor); };
  proto.savepoint = function clientSavepoint(name, options) {
    if (!this._transactionDepth) return Promise.reject(new Error('NuBloxSQL savepoints require an active transaction client'));
    return savepoint(this, name, options);
  };
  proto.rollbackTo = function clientRollbackTo(name, options) {
    if (!this._transactionDepth) return Promise.reject(new Error('NuBloxSQL savepoints require an active transaction client'));
    return rollbackTo(this, name, options);
  };
  proto.releaseSavepoint = function clientReleaseSavepoint(name, options) {
    if (!this._transactionDepth) return Promise.reject(new Error('NuBloxSQL savepoints require an active transaction client'));
    return releaseSavepoint(this, name, options);
  };

  var originalTransaction = proto.transaction;
  proto.transaction = async function advancedTransaction(fn, options) {
    if (typeof fn !== 'function') throw new TypeError('NuBloxSQL transaction requires a function');
    var normalized = policy.normalizeOptions(options);
    var depth = this._transactionDepth || 0;
    validateDialectOptions(this, normalized, depth > 0);

    if (depth > 0) {
      var nestedName = policy.savepointName(depth + 1);
      await savepoint(this, nestedName, normalized);
      this._transactionDepth = depth + 1;
      try {
        var nestedValue = await fn(this);
        await releaseSavepoint(this, nestedName, normalized);
        return nestedValue;
      } catch (error) {
        try { await rollbackTo(this, nestedName, normalized); } catch (rollbackError) { error.rollbackError = rollbackError; }
        try { await releaseSavepoint(this, nestedName, normalized); } catch (releaseError) { error.releaseError = releaseError; }
        throw error;
      } finally {
        this._transactionDepth = depth;
      }
    }

    var retry = normalized.retry;
    var nativeOptions = policy.nativeOptions(normalized);
    var attempt = 0;
    while (true) {
      attempt += 1;
      try {
        return await originalTransaction.call(this, async function markTransaction(transactionClient) {
          transactionClient._transactionDepth = 1;
          transactionClient.transactionAttempt = attempt;
          return fn(transactionClient);
        }, nativeOptions);
      } catch (error) {
        if (!policy.shouldRetry(error, retry, attempt)) throw error;
        observabilityApi.emit(this, observabilityApi.EVENT_TYPES.TRANSACTION_RETRY, {
          operation: 'transaction',
          success: false,
          completedAttempt: attempt,
          nextAttempt: attempt + 1,
          errorCategory: error && error.category || null,
          errorCode: error && error.code || null,
          retryable: true
        });
        if (retry && typeof retry.onRetry === 'function') await retry.onRetry(error, attempt, attempt + 1);
        await policy.delay(retry, attempt);
      }
    }
  };

  Object.defineProperty(proto, '_nubloxAdvancedTransactionsInstalled', { value: true });
}

exports.install = install;
exports.assertSavepointName = assertSavepointName;
exports.validateDialectOptions = validateDialectOptions;
