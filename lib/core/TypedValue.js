'use strict';

var TYPED_VALUE = Symbol.for('NuBloxSQL.TypedValue');

var TYPE_ALIASES = Object.freeze({
  decimal: 'decimal',
  numeric: 'decimal',
  uuid: 'uuid',
  guid: 'uuid'
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
  if (fraction.length > spec.scale) {
    throw new RangeError('NuBloxSQL decimal value exceeds configured scale ' + spec.scale);
  }
  var significantIntegerDigits = integerDigits === '0' ? 1 : integerDigits.length;
  if (significantIntegerDigits + spec.scale > spec.precision) {
    throw new RangeError('NuBloxSQL decimal value exceeds configured precision ' + spec.precision);
  }
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

function normalizeValue(value, spec) {
  if (spec.type === 'decimal') return normalizeDecimal(value, spec);
  if (spec.type === 'uuid') return normalizeUuid(value);
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
