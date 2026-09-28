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
  int8      : int8,
  uint8     : uint8,
  int16     : int16,
  uint16    : uint16,
  int32     : int32,
  uint32    : uint32,
  int64     : int64,
  uint64    : uint64,
  float     : float,
  double    : double,
  decimal   : decimal,
  text      : text,
  binary    : binary,
  bit       : bit,
  year      : year,
  date      : date,
  datetime  : datetime,
  timestamp : timestamp,
  time      : time,
  json      : json
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

function bit(value) {
  return create(Types.BIT, true, bitBuffer(value));
}

function year(value) {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw parameterError('year must be an integer number', 'PREPARED_PARAMETER_INVALID_YEAR');
  }

  if (value !== 0 && (value < 1901 || value > 2155)) {
    throw parameterError('year must be 0 or in the range 1901 to 2155', 'PREPARED_PARAMETER_YEAR_RANGE');
  }

  return create(Types.YEAR, true, value);
}

function date(value) {
  return create(Types.DATE, false, parseDate(value));
}

function datetime(value) {
  return create(Types.DATETIME, false, parseDateTime(value));
}

function timestamp(value) {
  return create(Types.TIMESTAMP, false, parseDateTime(value));
}

function time(value) {
  return create(Types.TIME, false, parseTime(value));
}

function json(value) {
  var serialized;

  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw parameterError('json value must be serializable', 'PREPARED_PARAMETER_INVALID_JSON');
  }

  if (serialized === undefined) {
    throw parameterError('json value must be serializable', 'PREPARED_PARAMETER_INVALID_JSON');
  }

  return create(Types.JSON, false, serialized);
}

function bitBuffer(value) {
  if (Buffer.isBuffer(value)) {
    return checkedBitBuffer(Buffer.from(value));
  }

  if (value instanceof global.Uint8Array) {
    return checkedBitBuffer(Buffer.from(value));
  }

  if (typeof value === 'string') {
    if (!/^[01]{1,64}$/.test(value)) {
      throw parameterError('bit string must contain 1 to 64 binary digits', 'PREPARED_PARAMETER_INVALID_BIT');
    }

    return bigintBitBuffer(global.BigInt('0b' + value));
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw parameterError('bit number must be a non-negative safe integer', 'PREPARED_PARAMETER_INVALID_BIT');
    }
    value = global.BigInt(value);
  }

  if (typeof value === 'bigint') {
    if (value < global.BigInt(0) || value > UINT64_MAX) {
      throw parameterError('bit value is outside the MySQL BIT(64) range', 'PREPARED_PARAMETER_BIT_RANGE');
    }
    return bigintBitBuffer(value);
  }

  throw parameterError('bit must be a bigint, safe integer, binary string, Buffer or Uint8Array', 'PREPARED_PARAMETER_INVALID_BIT');
}

function bigintBitBuffer(value) {
  if (value === global.BigInt(0)) {
    return Buffer.from([0]);
  }

  var bytes = [];
  var current = value;

  while (current > global.BigInt(0)) {
    bytes.unshift(Number(current & global.BigInt(255)));
    current >>= global.BigInt(8);
  }

  return Buffer.from(bytes);
}

function checkedBitBuffer(value) {
  if (value.length < 1 || value.length > 8) {
    throw parameterError('bit Buffer must contain between 1 and 8 bytes', 'PREPARED_PARAMETER_BIT_RANGE');
  }

  return value;
}

function parseDate(value) {
  if (value instanceof Date) {
    assertValidDate(value);
    return temporalValue(value.getFullYear(), value.getMonth() + 1, value.getDate(), 0, 0, 0, 0);
  }

  if (typeof value !== 'string') {
    throw parameterError('date must be a Date or YYYY-MM-DD string', 'PREPARED_PARAMETER_INVALID_DATE');
  }

  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw parameterError('date must use YYYY-MM-DD format', 'PREPARED_PARAMETER_INVALID_DATE');
  }

  return checkedTemporal(Number(match[1]), Number(match[2]), Number(match[3]), 0, 0, 0, 0, 'date');
}

function parseDateTime(value) {
  if (value instanceof Date) {
    assertValidDate(value);
    return temporalValue(
      value.getFullYear(),
      value.getMonth() + 1,
      value.getDate(),
      value.getHours(),
      value.getMinutes(),
      value.getSeconds(),
      value.getMilliseconds() * 1000
    );
  }

  if (typeof value !== 'string') {
    throw parameterError('datetime must be a Date or YYYY-MM-DD HH:MM:SS[.ffffff] string', 'PREPARED_PARAMETER_INVALID_DATETIME');
  }

  var match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) {
    throw parameterError('datetime must use YYYY-MM-DD HH:MM:SS[.ffffff] format', 'PREPARED_PARAMETER_INVALID_DATETIME');
  }

  var microseconds = match[7] ? Number((match[7] + '000000').slice(0, 6)) : 0;
  return checkedTemporal(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
    microseconds,
    'datetime'
  );
}

function parseTime(value) {
  if (typeof value !== 'string') {
    throw parameterError('time must be a [-]HHH:MM:SS[.ffffff] string', 'PREPARED_PARAMETER_INVALID_TIME');
  }

  var match = /^(-)?(\d{1,3}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) {
    throw parameterError('time must use [-]HHH:MM:SS[.ffffff] format', 'PREPARED_PARAMETER_INVALID_TIME');
  }

  var totalHours = Number(match[2]);
  var minutes = Number(match[3]);
  var seconds = Number(match[4]);
  var microseconds = match[5] ? Number((match[5] + '000000').slice(0, 6)) : 0;

  if (totalHours > 838 || minutes > 59 || seconds > 59) {
    throw parameterError('time is outside the MySQL TIME range', 'PREPARED_PARAMETER_TIME_RANGE');
  }

  return Object.freeze({
    negative     : Boolean(match[1]) && (totalHours !== 0 || minutes !== 0 || seconds !== 0 || microseconds !== 0),
    days         : Math.floor(totalHours / 24),
    hours        : totalHours % 24,
    minutes      : minutes,
    seconds      : seconds,
    microseconds : microseconds
  });
}

function checkedTemporal(year, month, day, hour, minute, second, microseconds, name) {
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw parameterError(name + ' contains an invalid calendar date', 'PREPARED_PARAMETER_INVALID_' + name.toUpperCase());
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59 || microseconds < 0 || microseconds > 999999) {
    throw parameterError(name + ' contains an invalid time', 'PREPARED_PARAMETER_INVALID_' + name.toUpperCase());
  }

  return temporalValue(year, month, day, hour, minute, second, microseconds);
}

function temporalValue(year, month, day, hour, minute, second, microseconds) {
  return Object.freeze({
    year         : year,
    month        : month,
    day          : day,
    hour         : hour,
    minute       : minute,
    second       : second,
    microseconds : microseconds
  });
}

function daysInMonth(year, month) {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }

  return [4, 6, 9, 11].indexOf(month) !== -1 ? 30 : 31;
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function assertValidDate(value) {
  if (isNaN(value.getTime())) {
    throw parameterError('Date value is invalid', 'PREPARED_PARAMETER_INVALID_DATETIME');
  }
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
