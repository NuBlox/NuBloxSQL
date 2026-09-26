'use strict';

var Buffer = require('safe-buffer').Buffer;
var Types = require('./protocol/constants/types');

var BRAND = '__nubloxTypedParameter';
var INT64_MIN = global.BigInt('-9223372036854775808');
var INT64_MAX = global.BigInt('9223372036854775807');
var UINT64_MAX = global.BigInt('18446744073709551615');

exports.is = isTypedParameter;
exports.unwrap = unwrap;
exports.api = Object.freeze({
  int8    : int8,
  uint8   : uint8,
  int16   : int16,
  uint16  : uint16,
  int32   : int32,
  uint32  : uint32,
  int64   : int64,
  uint64  : uint64,
  float   : float,
  double  : double,
  decimal : decimal,
  text    : text,
  binary  : binary
});

function create(type, unsigned, value) {
  return Object.freeze({
    __nubloxTypedParameter : true,
    type                   : type,
    unsigned               : Boolean(unsigned),
    value                  : value
  });
}

function isTypedParameter(value) {
  return Boolean(value && typeof value === 'object' && value[BRAND] === true);
}

function unwrap(value) {
  return isTypedParameter(value) ? value.value : value;
}

function int8(value) {
  return create(Types.TINY, false, integerNumber(value, -128, 127, 'int8'));
}

function uint8(value) {
  return create(Types.TINY, true, integerNumber(value, 0, 255, 'uint8'));
}

function int16(value) {
  return create(Types.SHORT, false, integerNumber(value, -32768, 32767, 'int16'));
}

function uint16(value) {
  return create(Types.SHORT, true, integerNumber(value, 0, 65535, 'uint16'));
}

function int32(value) {
  return create(Types.LONG, false, integerNumber(value, -2147483648, 2147483647, 'int32'));
}

function uint32(value) {
  return create(Types.LONG, true, integerNumber(value, 0, 4294967295, 'uint32'));
}

function int64(value) {
  return create(Types.LONGLONG, false, integerBigInt(value, INT64_MIN, INT64_MAX, 'int64'));
}

function uint64(value) {
  return create(Types.LONGLONG, true, integerBigInt(value, global.BigInt(0), UINT64_MAX, 'uint64'));
}

function float(value) {
  return create(Types.FLOAT, false, finiteNumber(value, 'float'));
}

function double(value) {
  return create(Types.DOUBLE, false, finiteNumber(value, 'double'));
}

function decimal(value) {
  var textValue;

  if (typeof value === 'number') {
    if (!isFinite(value)) {
      throw parameterError('decimal must be finite', 'PREPARED_PARAMETER_INVALID_DECIMAL');
    }
    textValue = String(value);
  } else if (typeof value === 'bigint' || typeof value === 'string') {
    textValue = String(value);
  } else {
    throw parameterError('decimal must be a number, bigint or decimal string', 'PREPARED_PARAMETER_INVALID_DECIMAL');
  }

  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(textValue)) {
    throw parameterError('decimal string is not a base-10 fixed-point value', 'PREPARED_PARAMETER_INVALID_DECIMAL');
  }

  return create(Types.NEWDECIMAL, false, textValue);
}

function text(value) {
  if (typeof value !== 'string') {
    throw parameterError('text must be a string', 'PREPARED_PARAMETER_INVALID_TEXT');
  }

  return create(Types.VAR_STRING, false, value);
}

function binary(value) {
  if (Buffer.isBuffer(value)) {
    return create(Types.BLOB, false, value);
  }

  if (value instanceof global.Uint8Array) {
    return create(Types.BLOB, false, Buffer.from(value));
  }

  throw parameterError('binary must be a Buffer or Uint8Array', 'PREPARED_PARAMETER_INVALID_BINARY');
}

function integerNumber(value, min, max, name) {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw parameterError(name + ' must be an integer number', 'PREPARED_PARAMETER_INVALID_INTEGER');
  }

  if (value < min || value > max) {
    throw parameterError(name + ' is outside its supported range', 'PREPARED_PARAMETER_INTEGER_RANGE');
  }

  return value;
}

function integerBigInt(value, min, max, name) {
  var parsed;

  if (typeof value === 'bigint') {
    parsed = value;
  } else if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw parameterError(name + ' number input must be a safe integer; use bigint or string for wider values', 'PREPARED_PARAMETER_INVALID_INTEGER');
    }
    parsed = global.BigInt(value);
  } else if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    parsed = global.BigInt(value);
  } else {
    throw parameterError(name + ' must be a bigint, safe integer number or integer string', 'PREPARED_PARAMETER_INVALID_INTEGER');
  }

  if (parsed < min || parsed > max) {
    throw parameterError(name + ' is outside its supported range', 'PREPARED_PARAMETER_INTEGER_RANGE');
  }

  return parsed;
}

function finiteNumber(value, name) {
  if (typeof value !== 'number' || !isFinite(value)) {
    throw parameterError(name + ' must be a finite number', 'PREPARED_PARAMETER_INVALID_NUMBER');
  }

  return value;
}

function parameterError(message, code) {
  var error = new TypeError(message);
  error.code = code;
  return error;
}
