'use strict';

var ISOLATION_LEVELS = Object.freeze([
  'read-uncommitted',
  'read-committed',
  'repeatable-read',
  'serializable'
]);

function normalizeOptions(options) {
  options = options || {};
  if (typeof options !== 'object' || Array.isArray(options)) throw new TypeError('NuBloxSQL transaction options must be an object');
  if (options.isolationLevel !== undefined && ISOLATION_LEVELS.indexOf(options.isolationLevel) === -1) {
    throw new RangeError('Unsupported NuBloxSQL transaction isolation level: ' + options.isolationLevel);
  }
  if (options.readOnly !== undefined && typeof options.readOnly !== 'boolean') throw new TypeError('NuBloxSQL transaction readOnly must be boolean');
  if (options.deferrable !== undefined && typeof options.deferrable !== 'boolean') throw new TypeError('NuBloxSQL transaction deferrable must be boolean');
  if (options.mode !== undefined && ['deferred', 'immediate', 'exclusive'].indexOf(options.mode) === -1) {
    throw new RangeError('NuBloxSQL SQLite transaction mode must be deferred, immediate or exclusive');
  }

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
    retry = Object.assign({}, retry, { maxAttempts: maxAttempts });
  }
  return Object.assign({}, options, { retry: retry });
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

function savepointName(depth) {
  return 'nublox_nested_' + String(depth);
}

exports.ISOLATION_LEVELS = ISOLATION_LEVELS;
exports.normalizeOptions = normalizeOptions;
exports.shouldRetry = shouldRetry;
exports.delay = delay;
exports.savepointName = savepointName;
