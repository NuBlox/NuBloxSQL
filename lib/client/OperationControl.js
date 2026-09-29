'use strict';

var errors = require('./Error');

function positiveNumber(value, name) {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(name + ' must be a positive finite number');
  return Number(value);
}

function deadlineTimestamp(value) {
  if (value === undefined) return undefined;
  var timestamp = value instanceof Date ? value.getTime() : value;
  if (!Number.isFinite(timestamp)) throw new RangeError('NuBloxSQL operation deadline must be a finite epoch millisecond value or valid Date');
  return Number(timestamp);
}

function validateSignal(signal) {
  if (signal === undefined) return;
  if (!signal || typeof signal !== 'object' || typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function') {
    throw new TypeError('NuBloxSQL operation signal must be an AbortSignal');
  }
}

function cancelledError(client, operation, signal) {
  return new errors.NuBloxSqlError('NuBloxSQL ' + operation + ' was cancelled before execution', {
    category: errors.CATEGORIES.CANCELLED,
    dialect: client.dialect,
    operation: operation,
    retryable: false,
    native: signal && signal.reason instanceof Error ? signal.reason : null,
    cause: signal && signal.reason instanceof Error ? signal.reason : undefined
  });
}

function timeoutError(client, operation) {
  return new errors.NuBloxSqlError('NuBloxSQL ' + operation + ' deadline exceeded before execution', {
    category: errors.CATEGORIES.TIMEOUT,
    dialect: client.dialect,
    operation: operation,
    retryable: true,
    native: null
  });
}

function hasControl(options) {
  return options.timeout !== undefined || options.deadline !== undefined || options.signal !== undefined;
}

function normalizeAcquire(options, effectiveDeadline) {
  var acquire = Object.assign({}, options.acquire || {});
  if (options.signal !== undefined && acquire.signal === undefined) acquire.signal = options.signal;
  if (effectiveDeadline !== undefined && acquire.deadline === undefined) acquire.deadline = effectiveDeadline;
  if (acquire.timeout !== undefined) positiveNumber(acquire.timeout, 'NuBloxSQL pool acquisition timeout');
  return Object.keys(acquire).length ? acquire : undefined;
}

function normalize(client, operation, options, now) {
  if (options === undefined || options === null) options = {};
  if (typeof options !== 'object' || Array.isArray(options)) throw new TypeError('NuBloxSQL ' + operation + ' options must be an object');

  var normalized = Object.assign({}, options);
  var signal = options.signal;
  validateSignal(signal);
  if (signal && signal.aborted) throw cancelledError(client, operation, signal);

  var timeout = positiveNumber(options.timeout, 'NuBloxSQL ' + operation + ' timeout');
  var explicitDeadline = deadlineTimestamp(options.deadline);
  var clock = now === undefined ? Date.now() : now;
  var timeoutDeadline = timeout === undefined ? undefined : clock + timeout;
  var effectiveDeadline;

  if (explicitDeadline !== undefined && timeoutDeadline !== undefined) effectiveDeadline = Math.min(explicitDeadline, timeoutDeadline);
  else effectiveDeadline = explicitDeadline === undefined ? timeoutDeadline : explicitDeadline;

  if (effectiveDeadline !== undefined) {
    var remaining = effectiveDeadline - clock;
    if (remaining <= 0) throw timeoutError(client, operation);
    normalized.timeout = remaining;
    normalized.deadline = effectiveDeadline;
  }

  if (client.dialect === 'sqlite' && hasControl(options)) {
    throw errors.unsupportedError(client.dialect, 'per-operation timeout, deadline and AbortSignal control');
  }

  var acquire = normalizeAcquire(normalized, effectiveDeadline);
  if (acquire !== undefined) normalized.acquire = acquire;
  return normalized;
}

exports.normalize = normalize;
exports.deadlineTimestamp = deadlineTimestamp;
exports.validateSignal = validateSignal;