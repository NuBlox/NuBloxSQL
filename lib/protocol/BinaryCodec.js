'use strict';

var Buffer = require('safe-buffer').Buffer;
var Charsets = require('./constants/charsets');
var FieldFlags = require('./constants/field_flags');
var TypedParameter = require('../TypedParameter');
var Types = require('./constants/types');

exports.describeParameter = describeParameter;
exports.isNullParameter = isNullParameter;
exports.parseValue = parseValue;
exports.writeParameterValue = writeParameterValue;

function describeParameter(value) {
  if (TypedParameter.is(value)) {
    return {type: value.type, unsigned: value.unsigned};
  }

  if (value === undefined) {
    var error = new TypeError('Prepared statement parameters must not contain undefined');
    error.code = 'PREPARED_STATEMENT_UNDEFINED_PARAMETER';
    throw error;
  }

  if (value === null) {
    return {type: Types.NULL, unsigned: false};
  }

  if (Buffer.isBuffer(value)) {
    return {type: Types.BLOB, unsigned: false};
  }

  if (value instanceof Date) {
    return {type: Types.DATETIME, unsigned: false};
  }

  switch (typeof value) {
    case 'boolean':
      return {type: Types.TINY, unsigned: false};
    case 'number':
      if (!isFinite(value)) {
        var numberError = new TypeError('Prepared statement numbers must be finite');
        numberError.code = 'PREPARED_STATEMENT_NON_FINITE_NUMBER';
        throw numberError;
      }
      return {type: Types.DOUBLE, unsigned: false};
    case 'bigint':
      return {type: Types.VAR_STRING, unsigned: false};
    case 'string':
      return {type: Types.VAR_STRING, unsigned: false};
    default:
      var typeError = new TypeError('Unsupported prepared statement parameter type: ' + typeof value);
      typeError.code = 'PREPARED_STATEMENT_UNSUPPORTED_PARAMETER';
      throw typeError;
  }
}

function isNullParameter(value) {
  return TypedParameter.unwrap(value) === null;
}

function writeParameterValue(writer, value, descriptor) {
  var buffer;

  value = TypedParameter.unwrap(value);

  if (value === null || descriptor.type === Types.NULL) {
    return;
  }

  switch (descriptor.type) {
    case Types.TINY:
      writeInteger(writer, value, 1, descriptor.unsigned);
      return;
    case Types.SHORT:
    case Types.YEAR:
      writeInteger(writer, value, 2, descriptor.unsigned);
      return;
    case Types.LONG:
    case Types.INT24:
      writeInteger(writer, value, 4, descriptor.unsigned);
      return;
    case Types.LONGLONG:
      writeLongLong(writer, value, descriptor.unsigned);
      return;
    case Types.FLOAT:
      buffer = Buffer.allocUnsafe(4);
      buffer.writeFloatLE(value, 0);
      writer.writeBuffer(buffer);
      return;
    case Types.DOUBLE:
      buffer = Buffer.allocUnsafe(8);
      buffer.writeDoubleLE(value, 0);
      writer.writeBuffer(buffer);
      return;
    case Types.DATE:
    case Types.NEWDATE:
      writeDate(writer, value);
      return;
    case Types.DATETIME:
    case Types.DATETIME2:
    case Types.TIMESTAMP:
    case Types.TIMESTAMP2:
      writeDateTime(writer, value);
      return;
    case Types.TIME:
    case Types.TIME2:
      writeTime(writer, value);
      return;
    case Types.DECIMAL:
    case Types.NEWDECIMAL:
    case Types.STRING:
    case Types.VARCHAR:
    case Types.VAR_STRING:
      writer.writeLengthCodedString(String(value));
      return;
    case Types.JSON:
      writer.writeLengthCodedString(typeof value === 'string' ? value : JSON.stringify(value));
      return;
    case Types.BIT:
      writer.writeLengthCodedBuffer(value);
      return;
    case Types.TINY_BLOB:
    case Types.MEDIUM_BLOB:
    case Types.LONG_BLOB:
    case Types.BLOB:
      writer.writeLengthCodedBuffer(value);
      return;
    default:
      var error = new TypeError('Unsupported prepared statement protocol type: ' + descriptor.type);
      error.code = 'PREPARED_STATEMENT_UNSUPPORTED_PROTOCOL_TYPE';
      throw error;
  }
}

function writeInteger(writer, value, bytes, unsigned) {
  var buffer = Buffer.allocUnsafe(bytes);
  var number = typeof value === 'boolean' ? (value ? 1 : 0) : value;

  if (bytes === 1) {
    unsigned ? buffer.writeUInt8(number, 0) : buffer.writeInt8(number, 0);
  } else if (bytes === 2) {
    unsigned ? buffer.writeUInt16LE(number, 0) : buffer.writeInt16LE(number, 0);
  } else {
    unsigned ? buffer.writeUInt32LE(number, 0) : buffer.writeInt32LE(number, 0);
  }

  writer.writeBuffer(buffer);
}

function writeLongLong(writer, value, unsigned) {
  var buffer = Buffer.allocUnsafe(8);
  var integer = typeof value === 'bigint' ? value : global.BigInt(value);

  if (unsigned) {
    buffer.writeBigUInt64LE(integer, 0);
  } else {
    buffer.writeBigInt64LE(integer, 0);
  }

  writer.writeBuffer(buffer);
}

function writeDate(writer, value) {
  var parts = dateTimeParts(value);

  writer.writeUnsignedNumber(1, 4);
  writer.writeUnsignedNumber(2, parts.year);
  writer.writeUnsignedNumber(1, parts.month);
  writer.writeUnsignedNumber(1, parts.day);
}

function writeDateTime(writer, value) {
  var parts = dateTimeParts(value);
  var hasTime = parts.hour !== 0 || parts.minute !== 0 || parts.second !== 0;
  var length = parts.microseconds !== 0 ? 11 : (hasTime ? 7 : 4);

  writer.writeUnsignedNumber(1, length);
  writer.writeUnsignedNumber(2, parts.year);
  writer.writeUnsignedNumber(1, parts.month);
  writer.writeUnsignedNumber(1, parts.day);

  if (length >= 7) {
    writer.writeUnsignedNumber(1, parts.hour);
    writer.writeUnsignedNumber(1, parts.minute);
    writer.writeUnsignedNumber(1, parts.second);
  }

  if (length === 11) {
    writer.writeUnsignedNumber(4, parts.microseconds);
  }
}

function writeTime(writer, value) {
  var hasValue = value.days !== 0 || value.hours !== 0 || value.minutes !== 0 || value.seconds !== 0 || value.microseconds !== 0;

  if (!hasValue) {
    writer.writeUnsignedNumber(1, 0);
    return;
  }

  var length = value.microseconds !== 0 ? 12 : 8;
  writer.writeUnsignedNumber(1, length);
  writer.writeUnsignedNumber(1, value.negative ? 1 : 0);
  writer.writeUnsignedNumber(4, value.days);
  writer.writeUnsignedNumber(1, value.hours);
  writer.writeUnsignedNumber(1, value.minutes);
  writer.writeUnsignedNumber(1, value.seconds);

  if (length === 12) {
    writer.writeUnsignedNumber(4, value.microseconds);
  }
}

function dateTimeParts(value) {
  if (value instanceof Date) {
    if (isNaN(value.getTime())) {
      var error = new TypeError('Prepared statement Date parameter is invalid');
      error.code = 'PREPARED_STATEMENT_INVALID_DATE';
      throw error;
    }

    return {
      year         : value.getFullYear(),
      month        : value.getMonth() + 1,
      day          : value.getDate(),
      hour         : value.getHours(),
      minute       : value.getMinutes(),
      second       : value.getSeconds(),
      microseconds : value.getMilliseconds() * 1000
    };
  }

  return value;
}

function parseValue(parser, field, connection) {
  var config = connection.config;
  var buffer;
  var value;
  var unsigned = Boolean(field.flags & FieldFlags.UNSIGNED_FLAG);

  switch (field.type) {
    case Types.TINY:
      buffer = parser.parseBuffer(1);
      return unsigned ? buffer.readUInt8(0) : buffer.readInt8(0);
    case Types.SHORT:
    case Types.YEAR:
      buffer = parser.parseBuffer(2);
      return unsigned ? buffer.readUInt16LE(0) : buffer.readInt16LE(0);
    case Types.LONG:
    case Types.INT24:
      buffer = parser.parseBuffer(4);
      return unsigned ? buffer.readUInt32LE(0) : buffer.readInt32LE(0);
    case Types.FLOAT:
      return parser.parseBuffer(4).readFloatLE(0);
    case Types.DOUBLE:
      return parser.parseBuffer(8).readDoubleLE(0);
    case Types.LONGLONG:
      return parseLongLong(parser.parseBuffer(8), unsigned, config);
    case Types.DATE:
    case Types.NEWDATE:
    case Types.DATETIME:
    case Types.DATETIME2:
    case Types.TIMESTAMP:
    case Types.TIMESTAMP2:
      return parseDateTime(parser, field, config);
    case Types.TIME:
    case Types.TIME2:
      return parseTime(parser);
    case Types.BIT:
      return parser.parseLengthCodedBuffer();
    case Types.JSON:
      value = parser.parseLengthCodedString();
      if (value === null) {
        return null;
      }
      try {
        return JSON.parse(value);
      } catch (error) {
        return value;
      }
    case Types.DECIMAL:
    case Types.NEWDECIMAL:
      return parser.parseLengthCodedString();
    case Types.STRING:
    case Types.VARCHAR:
    case Types.VAR_STRING:
    case Types.ENUM:
    case Types.SET:
    case Types.TINY_BLOB:
    case Types.MEDIUM_BLOB:
    case Types.LONG_BLOB:
    case Types.BLOB:
      return field.charsetNr === Charsets.BINARY
        ? parser.parseLengthCodedBuffer()
        : parser.parseLengthCodedString();
    case Types.GEOMETRY:
      return parser.parseGeometryValue();
    default:
      return parser.parseLengthCodedString();
  }
}

function parseLongLong(buffer, unsigned, config) {
  var value = unsigned ? buffer.readBigUInt64LE(0) : buffer.readBigInt64LE(0);
  var asString = value.toString();
  var asNumber = Number(value);

  if (config.supportBigNumbers && (config.bigNumberStrings || !Number.isSafeInteger(asNumber))) {
    return asString;
  }

  return asNumber;
}

function parseDateTime(parser, field, config) {
  var length = parser.parseUnsignedNumber(1);

  if (length === 0) {
    return zeroDateValue(field.type, config.dateStrings);
  }

  var year = parser.parseUnsignedNumber(2);
  var month = parser.parseUnsignedNumber(1);
  var day = parser.parseUnsignedNumber(1);
  var hour = length >= 7 ? parser.parseUnsignedNumber(1) : 0;
  var minute = length >= 7 ? parser.parseUnsignedNumber(1) : 0;
  var second = length >= 7 ? parser.parseUnsignedNumber(1) : 0;
  var microseconds = length === 11 ? parser.parseUnsignedNumber(4) : 0;
  var dateOnly = field.type === Types.DATE || field.type === Types.NEWDATE;
  var text = pad(year, 4) + '-' + pad(month, 2) + '-' + pad(day, 2);

  if (!dateOnly) {
    text += ' ' + pad(hour, 2) + ':' + pad(minute, 2) + ':' + pad(second, 2);

    if (microseconds) {
      text += '.' + pad(microseconds, 6);
    }
  }

  if (typeMatch(field.type, config.dateStrings)) {
    return text;
  }

  var dateText = dateOnly ? text + ' 00:00:00' : text;
  if (config.timezone !== 'local') {
    dateText += ' ' + config.timezone;
  }

  var date = new Date(dateText);
  return isNaN(date.getTime()) ? text : date;
}

function parseTime(parser) {
  var length = parser.parseUnsignedNumber(1);

  if (length === 0) {
    return '00:00:00';
  }

  var negative = parser.parseUnsignedNumber(1) === 1;
  var days = parser.parseUnsignedNumber(4);
  var hours = parser.parseUnsignedNumber(1) + days * 24;
  var minutes = parser.parseUnsignedNumber(1);
  var seconds = parser.parseUnsignedNumber(1);
  var microseconds = length === 12 ? parser.parseUnsignedNumber(4) : 0;
  var value = (negative ? '-' : '') + pad(hours, 2) + ':' + pad(minutes, 2) + ':' + pad(seconds, 2);

  if (microseconds) {
    value += '.' + pad(microseconds, 6);
  }

  return value;
}

function zeroDateValue(type, dateStrings) {
  var dateOnly = type === Types.DATE || type === Types.NEWDATE;
  var value = dateOnly ? '0000-00-00' : '0000-00-00 00:00:00';

  return typeMatch(type, dateStrings) ? value : value;
}

function typeMatch(type, list) {
  if (Array.isArray(list)) {
    return list.indexOf(typeName(type)) !== -1;
  }

  return Boolean(list);
}

function typeName(type) {
  var names = Object.keys(Types);

  for (var i = 0; i < names.length; i++) {
    if (Types[names[i]] === type) {
      return names[i];
    }
  }

  return undefined;
}

function pad(value, length) {
  var text = String(value);

  while (text.length < length) {
    text = '0' + text;
  }

  return text;
}
