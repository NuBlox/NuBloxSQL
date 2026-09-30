'use strict';

var ISOLATION_LEVELS = Object.freeze([
  'read-uncommitted',
  'read-committed',
  'repeatable-read',
  'serializable'
]);
var SQLITE_MODES = Object.freeze(['deferred', 'immediate', 'exclusive']);

function normalizeOptions(options) {
  options = options || {};
  if (typeof options !== 'object' || Array.isArray(options)) throw new TypeError('NuBloxSQL transaction options must be an object');
  if (options.isolationLevel !== undefined && ISOLATION_LEVELS.indexOf(options.isolationLevel) === -1) throw new RangeError('Unsupported NuBloxSQL transaction isolation level: ' + options.isolationLevel);
  if (options.readOnly !== undefined && typeof options.readOnly !== 'boolean') throw new TypeError('NuBloxSQL transaction readOnly must be boolean');
  if (options.deferrable !== undefined && typeof options.deferrable !== 'boolean') throw new TypeError('NuBloxSQL transaction deferrable must be boolean');
  if (options.mode !== undefined && SQLITE_MODES.indexOf(options.mode) === -1) throw new RangeError('NuBloxSQL SQLite transaction mode must be deferred, immediate or exclusive');

  var retry = options.retry;
  if (retry === undefined && options.retries !== undefined) {
    if (!Number.isInteger(options.retries) || options.retries < 0 || options.retries > 99) throw new RangeError('NuBloxSQL transaction retries must be an integer from 0 to 99');
    if (options.retries > 0) retry = { maxAttempts: options.retries + 1, delayMs: options.retryDelayMs };
  }
  if (retry !== undefined && retry !== false) {
    if (retry === true) retry = { maxAttempts: 3 };
    if (!retry || typeof retry !== 'object' || Array.isArray(retry)) throw new TypeError('NuBloxSQL transaction retry must be false, true, or an options object');
    var maxAttempts = retry.maxAttempts === undefined ? 3 : retry.maxAttempts;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) throw new RangeError('NuBloxSQL transaction retry maxAttempts must be an integer from 1 to 100');
    if (retry.shouldRetry !== undefined && typeof retry.shouldRetry !== 'function') throw new TypeError('NuBloxSQL transaction retry shouldRetry must be a function');
    if (retry.delayMs !== undefined && typeof retry.delayMs !== 'function' && (!Number.isFinite(Number(retry.delayMs)) || Number(retry.delayMs) < 0)) throw new RangeError('NuBloxSQL transaction retry delay must be a non-negative number or function');
    if (retry.onRetry !== undefined && typeof retry.onRetry !== 'function') throw new TypeError('NuBloxSQL transaction retry onRetry must be a function');
    retry = Object.assign({}, retry, { maxAttempts: maxAttempts });
  }
  return Object.assign({}, options, { retry: retry });
}

function nativeOptions(options) {
  var out = Object.assign({}, options || {});
  delete out.retry;
  delete out.retries;
  delete out.retryDelayMs;
  return out;
}

function shouldRetry(error, retry, attempt) {
  if (!retry || retry === false || attempt >= retry.maxAttempts) return false;
  if (typeof retry.shouldRetry === 'function') return retry.shouldRetry(error, attempt) === true;
  return !!(error && (error.retryable === true || error.category === 'deadlock' || error.category === 'serialization'));
}

function delay(retry, attempt) {
  if (!retry || retry === false) return Promise.resolve();
  var value = typeof retry.delayMs === 'function' ? retry.delayMs(attempt) : retry.delayMs;
  if (value === undefined) value = Math.min(1000, 25 * Math.pow(2, attempt - 1));
  value = Number(value);
  if (!Number.isFinite(value) || value < 0) throw new RangeError('NuBloxSQL transaction retry delay must be a non-negative number');
  return new Promise(function (resolve) { setTimeout(resolve, value); });
}

function savepointName(depth) { return 'nublox_nested_' + String(depth); }

function capability(descriptor, name) {
  return !!(descriptor && descriptor.capabilities && descriptor.capabilities[name] === true);
}

function describe(dialect, descriptor) {
  return Object.freeze({
    dialect: dialect,
    transactions: capability(descriptor, 'transactions'),
    nestedTransactions: capability(descriptor, 'nestedTransactions'),
    savepoints: capability(descriptor, 'savepoints'),
    isolationLevels: Object.freeze(capability(descriptor, 'transactionIsolation') ? ISOLATION_LEVELS.slice() : []),
    readOnly: capability(descriptor, 'readOnlyTransactions'),
    deferrable: capability(descriptor, 'deferrableTransactions'),
    sqliteModes: Object.freeze(dialect === 'sqlite' ? SQLITE_MODES.slice() : []),
    retries: Object.freeze({
      supported: true,
      defaultMaxAttempts: 1,
      automaticCategories: Object.freeze(['deadlock', 'serialization']),
      requiresRollbackBeforeRetry: true,
      nested: false
    }),
    guarantees: Object.freeze({
      callbackCommit: true,
      callbackFailureRollback: true,
      nestedSavepointRollback: capability(descriptor, 'savepoints'),
      cleanupFailuresAttachedToOriginalError: true
    })
  });
}

exports.ISOLATION_LEVELS = ISOLATION_LEVELS;
exports.SQLITE_MODES = SQLITE_MODES;
exports.normalizeOptions = normalizeOptions;
exports.nativeOptions = nativeOptions;
exports.shouldRetry = shouldRetry;
exports.delay = delay;
exports.savepointName = savepointName;
exports.describe = describe;
