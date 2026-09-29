'use strict';

function positiveTimeout(value, name) {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(name + ' timeout must be a positive number');
  return value;
}

function deadlineTimestamp(value, name) {
  if (value === undefined) return undefined;
  var timestamp = value instanceof Date ? value.getTime() : value;
  if (!Number.isFinite(timestamp)) throw new RangeError(name + ' deadline must be a finite epoch millisecond value or valid Date');
  return timestamp;
}

function deadlineError(name) {
  var error = new Error(name + ' deadline exceeded');
  error.code = 'NUBLOX_MYSQL_DEADLINE_EXCEEDED';
  return error;
}

function normalize(options, name, fallbackTimeout, now) {
  options = options || {};
  var normalized = Object.assign({}, options);
  var timeout = positiveTimeout(options.timeout, name);
  if (timeout === undefined && fallbackTimeout !== undefined) timeout = positiveTimeout(fallbackTimeout, name);

  var deadline = deadlineTimestamp(options.deadline, name);
  if (deadline !== undefined) {
    var remaining = deadline - (now === undefined ? Date.now() : now);
    if (remaining <= 0) throw deadlineError(name);
    timeout = timeout === undefined ? remaining : Math.min(timeout, remaining);
  }

  if (timeout !== undefined) normalized.timeout = timeout;
  return normalized;
}

function deriveTotalDeadline(options, name, now) {
  options = options || {};
  var normalized = normalize(options, name, undefined, now);
  if (normalized.timeout === undefined) return normalized;
  var base = now === undefined ? Date.now() : now;
  var timeoutDeadline = base + normalized.timeout;
  var explicitDeadline = deadlineTimestamp(options.deadline, name);
  normalized.deadline = explicitDeadline === undefined ? timeoutDeadline : Math.min(explicitDeadline, timeoutDeadline);
  return normalized;
}

function acquisitionOptions(options) {
  options = options || {};
  var acquire = Object.assign({}, options.acquire || {});
  if (acquire.signal === undefined && options.signal !== undefined) acquire.signal = options.signal;
  if (acquire.deadline === undefined && options.deadline !== undefined) acquire.deadline = options.deadline;
  return acquire;
}

exports.normalize = normalize;
exports.deriveTotalDeadline = deriveTotalDeadline;
exports.acquisitionOptions = acquisitionOptions;
exports.deadlineError = deadlineError;
