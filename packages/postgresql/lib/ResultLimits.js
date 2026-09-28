'use strict';

var DEFAULT_MAX_ROWS = 100000;
var DEFAULT_MAX_RESULT_BYTES = 64 * 1024 * 1024;
var DEFAULT_MAX_ROW_BYTES = 16 * 1024 * 1024;

function positiveInteger(value, fallback, name) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(name + ' must be a positive integer');
  return value;
}

function PostgreSqlResultLimitError(message, details) {
  RangeError.call(this, message);
  this.name = 'PostgreSqlResultLimitError';
  this.message = message;
  this.code = details.code;
  this.limit = details.limit;
  this.observed = details.observed;
  if (Error.captureStackTrace) Error.captureStackTrace(this, PostgreSqlResultLimitError);
}
PostgreSqlResultLimitError.prototype = Object.create(RangeError.prototype);
PostgreSqlResultLimitError.prototype.constructor = PostgreSqlResultLimitError;

function create(config, options) {
  config = config || {};
  options = options || {};
  return {
    maxRows: positiveInteger(options.maxRows, positiveInteger(config.maxRows, DEFAULT_MAX_ROWS, 'PostgreSQL maxRows'), 'PostgreSQL maxRows'),
    maxResultBytes: positiveInteger(options.maxResultBytes, positiveInteger(config.maxResultBytes, DEFAULT_MAX_RESULT_BYTES, 'PostgreSQL maxResultBytes'), 'PostgreSQL maxResultBytes'),
    maxRowBytes: positiveInteger(options.maxRowBytes, positiveInteger(config.maxRowBytes, DEFAULT_MAX_ROW_BYTES, 'PostgreSQL maxRowBytes'), 'PostgreSQL maxRowBytes'),
    rowCount: 0,
    resultBytes: 0
  };
}

function rowBytes(message) {
  var total = 0;
  var values = message && message.values ? message.values : [];
  for (var i = 0; i < values.length; i++) if (values[i] !== null) total += values[i].length;
  return total;
}

function observeRow(state, message) {
  if (!state || !state._resultLimits) return;
  var limits = state._resultLimits;
  var bytes = rowBytes(message);
  if (bytes > limits.maxRowBytes) {
    throw new PostgreSqlResultLimitError('PostgreSQL row exceeded maxRowBytes', {
      code: 'NUBLOX_POSTGRESQL_MAX_ROW_BYTES', limit: limits.maxRowBytes, observed: bytes
    });
  }
  var nextRows = limits.rowCount + 1;
  if (nextRows > limits.maxRows) {
    throw new PostgreSqlResultLimitError('PostgreSQL result exceeded maxRows', {
      code: 'NUBLOX_POSTGRESQL_MAX_ROWS', limit: limits.maxRows, observed: nextRows
    });
  }
  var nextBytes = limits.resultBytes + bytes;
  if (nextBytes > limits.maxResultBytes) {
    throw new PostgreSqlResultLimitError('PostgreSQL result exceeded maxResultBytes', {
      code: 'NUBLOX_POSTGRESQL_MAX_RESULT_BYTES', limit: limits.maxResultBytes, observed: nextBytes
    });
  }
  limits.rowCount = nextRows;
  limits.resultBytes = nextBytes;
}

exports.DEFAULTS = Object.freeze({
  maxRows: DEFAULT_MAX_ROWS,
  maxResultBytes: DEFAULT_MAX_RESULT_BYTES,
  maxRowBytes: DEFAULT_MAX_ROW_BYTES
});
exports.PostgreSqlResultLimitError = PostgreSqlResultLimitError;
exports.create = create;
exports.observeRow = observeRow;
exports.rowBytes = rowBytes;
