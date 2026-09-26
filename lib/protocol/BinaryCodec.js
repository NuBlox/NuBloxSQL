'use strict';

var Buffer = require('safe-buffer').Buffer;
var Charsets = require('./constants/charsets');
var FieldFlags = require('./constants/field_flags');
var Types = require('./constants/types');

exports.describeParameter = describeParameter;
exports.parseValue = parseValue;
exports.writeParameterValue = writeParameterValue;

function describeParameter(value) {
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

function writeParameterValue(writer, value, descriptor) {
  var buffer;

  if (value === null || descriptor.type === Types.NULL) {
    return;
  }

  switch (descriptor.type) {
    case Types.TINY:
      writer.writeUnsignedNumber(1, value ? 1 : 0);
      return;
    case Types.DOUBLE:
      buffer = Buffer.allocUnsafe(8);
      buffer.writeDoubleLE(value, 0);
      writer.writeBuffer(buffer);
      return;
    case Types.DATETIME:
      writeDateTime(writer, value);
      return;
    case Types.BLOB:
      writer.writeLengthCodedBuffer(value);
      return;
    case Types.VAR_STRING:
      writer.writeLengthCodedString(String(value));
      return;
    default:
      var error = new TypeError('Unsupported prepared statement protocol type: ' + descriptor.type);
      error.code = 'PREPARED_STATEMENT_UNSUPPORTED_PROTOCOL_TYPE';
      throw error;
  }
}

function writeDateTime(writer, value) {
  writer.writeUnsignedNumber(1, 7);
  writer.writeUnsignedNumber(2, value.getFullYear());
  writer.writeUnsignedNumber(1, value.getMonth() + 1);
  writer.writeUnsignedNumber(1, value.getDate());
  writer.writeUnsignedNumber(1, value.getHours());
  writer.writeUnsignedNumber(1, value.getMinutes());
  writer.writeUnsignedNumber(1, value.getSeconds());
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
    case Types.GEOMETRY:
      return field.charsetNr === Charsets.BINARY
        ? parser.parseLengthCodedBuffer()
        : parser.parseLengthCodedString();
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
    return list.indexOf(Types[type]) !== -1;
  }

  return Boolean(list);
}

function pad(value, length) {
  var text = String(value);

  while (text.length < length) {
    text = '0' + text;
  }

  return text;
}
