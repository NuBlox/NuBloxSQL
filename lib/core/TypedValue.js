'use strict';

var TYPED_VALUE = Symbol.for('NuBloxSQL.TypedValue');

var TYPE_ALIASES = Object.freeze({
  decimal: 'decimal',
  numeric: 'decimal',
  uuid: 'uuid',
  guid: 'uuid',
  date: 'date',
  time: 'time',
  timestamp: 'timestamp',
  datetime: 'timestamp'
});

function normalizeTypeSpec(spec) {
  if (typeof spec === 'string') spec = { type: spec };
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new TypeError('NuBloxSQL typed value requires a type string or type specification object');
  }
  var rawType = String(spec.type || '').toLowerCase();
  var type = TYPE_ALIASES[rawType];
  if (!type) throw new RangeError('Unsupported NuBloxSQL portable bind type "' + rawType + '"');

  var normalized = { type: type };
  if (type === 'decimal') {
    var precision = spec.precision === undefined ? 38 : spec.precision;
    var scale = spec.scale === undefined ? 0 : spec.scale;
    if (!Number.isInteger(precision) || precision < 1 || precision > 38) {
      throw new RangeError('NuBloxSQL decimal precision must be an integer from 1 to 38');
    }
    if (!Number.isInteger(scale) || scale < 0 || scale > precision) {
      throw new RangeError('NuBloxSQL decimal scale must be an integer from 0 to precision');
    }
    normalized.precision = precision;
    normalized.scale = scale;
  } else if (type === 'time' || type === 'timestamp') {
    var temporalScale = spec.scale === undefined ? 6 : spec.scale;
    if (!Number.isInteger(temporalScale) || temporalScale < 0 || temporalScale > 6) {
      throw new RangeError('NuBloxSQL ' + type + ' scale must be an integer from 0 to 6');
    }
    normalized.scale = temporalScale;
  }
  return Object.freeze(normalized);
}

function normalizeDecimal(value, spec) {
  if (value === null) return null;
  if (typeof value === 'bigint') value = value.toString();
  if (typeof value !== 'string') {
    throw new TypeError('NuBloxSQL decimal values must be strings, bigint, or null to preserve exactness');
  }
  var match = value.match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  if (!match) throw new TypeError('NuBloxSQL decimal value must use plain decimal notation');
  var integerDigits = match[2].replace(/^0+(?=\d)/, '');
  var fraction = match[3] || '';
  if (fraction.length > spec.scale) throw new RangeError('NuBloxSQL decimal value exceeds configured scale ' + spec.scale);
  var maxIntegerDigits = spec.precision - spec.scale;
  var nonZeroIntegerDigits = integerDigits === '0' ? 0 : integerDigits.length;
  if (nonZeroIntegerDigits > maxIntegerDigits) throw new RangeError('NuBloxSQL decimal value exceeds configured precision ' + spec.precision);
  if (spec.scale > 0) fraction = fraction.padEnd(spec.scale, '0');
  else fraction = '';
  var sign = match[1] === '-' && (integerDigits !== '0' || /[1-9]/.test(fraction)) ? '-' : '';
  return sign + integerDigits + (spec.scale ? '.' + fraction : '');
}

function normalizeUuid(value) {
  if (value === null) return null;
  if (typeof value !== 'string') throw new TypeError('NuBloxSQL uuid value must be a string or null');
  var match = value.toLowerCase().match(/^\{?([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})\}?$/);
  if (!match) throw new TypeError('NuBloxSQL uuid value must be a valid 128-bit UUID');
  return match.slice(1).join('-');
}

function isLeapYear(year) { return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0); }
function daysInMonth(year, month) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].indexOf(month) !== -1 ? 30 : 31;
}
function normalizeDate(value) {
  if (value === null) return null;
  if (typeof value !== 'string') throw new TypeError('NuBloxSQL date values must be YYYY-MM-DD strings or null');
  var match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new TypeError('NuBloxSQL date value must use YYYY-MM-DD notation');
  var year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError('NuBloxSQL date value is outside the portable Gregorian calendar range');
  }
  return match[1] + '-' + match[2] + '-' + match[3];
}
function normalizeFraction(fraction, scale, label) {
  fraction = fraction || '';
  if (fraction.length > scale) throw new RangeError('NuBloxSQL ' + label + ' value exceeds configured scale ' + scale);
  if (scale === 0) return '';
  return '.' + fraction.padEnd(scale, '0');
}
function normalizeTime(value, spec) {
  if (value === null) return null;
  if (typeof value !== 'string') throw new TypeError('NuBloxSQL time values must be strings or null');
  var match = value.match(/^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/);
  if (!match) throw new TypeError('NuBloxSQL time value must use HH:MM:SS[.ffffff] notation');
  var hour = Number(match[1]), minute = Number(match[2]), second = Number(match[3]);
  if (hour > 23 || minute > 59 || second > 59) throw new RangeError('NuBloxSQL time value is outside the portable time-of-day range');
  return match[1] + ':' + match[2] + ':' + match[3] + normalizeFraction(match[4], spec.scale, 'time');
}
function normalizeTimestamp(value, spec) {
  if (value === null) return null;
  if (typeof value !== 'string') throw new TypeError('NuBloxSQL timestamp values must be strings or null');
  var match = value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/);
  if (!match) throw new TypeError('NuBloxSQL timestamp value must use YYYY-MM-DD[T ]HH:MM:SS[.ffffff] notation');
  var date = normalizeDate(match[1]);
  var time = normalizeTime(match[2] + (match[3] ? '.' + match[3] : ''), spec);
  return date + ' ' + time;
}

function normalizeValue(value, spec) {
  if (spec.type === 'decimal') return normalizeDecimal(value, spec);
  if (spec.type === 'uuid') return normalizeUuid(value);
  if (spec.type === 'date') return normalizeDate(value);
  if (spec.type === 'time') return normalizeTime(value, spec);
  if (spec.type === 'timestamp') return normalizeTimestamp(value, spec);
  return value;
}

function TypedValue(value, spec) {
  this.spec = normalizeTypeSpec(spec);
  this.value = normalizeValue(value, this.spec);
  Object.defineProperty(this, TYPED_VALUE, { value: true, enumerable: false });
  Object.freeze(this);
}

function typed(value, spec) { return new TypedValue(value, spec); }
function isTypedValue(value) { return !!(value && value[TYPED_VALUE] === true); }
function unwrap(value) { return isTypedValue(value) ? value.value : value; }

exports.TYPED_VALUE = TYPED_VALUE;
exports.TYPE_ALIASES = TYPE_ALIASES;
exports.normalizeTypeSpec = normalizeTypeSpec;
exports.TypedValue = TypedValue;
exports.typed = typed;
exports.isTypedValue = isTypedValue;
exports.unwrap = unwrap;
