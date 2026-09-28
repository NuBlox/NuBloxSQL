'use strict';

var BinaryCodec = require('./BinaryCodec');
var Buffer = require('safe-buffer').Buffer;
var Types = require('./constants/types');

exports.describe = describe;
exports.writeValue = writeValue;

function describe(value) {
  if (value === undefined) {
    var undefinedError = new TypeError('query attribute values must not be undefined');
    undefinedError.code = 'QUERY_ATTRIBUTE_UNDEFINED_VALUE';
    throw undefinedError;
  }

  if (value === null) {
    return {type: Types.NULL, unsigned: false, rawBuffer: false};
  }

  if (Buffer.isBuffer(value)) {
    return {type: Types.VAR_STRING, unsigned: false, rawBuffer: true};
  }

  if (value instanceof Date) {
    return {type: Types.DATETIME, unsigned: false, rawBuffer: false};
  }

  switch (typeof value) {
    case 'boolean':
      return {type: Types.TINY, unsigned: false, rawBuffer: false};
    case 'number':
      if (!isFinite(value)) {
        var numberError = new TypeError('query attribute numbers must be finite');
        numberError.code = 'QUERY_ATTRIBUTE_NON_FINITE_NUMBER';
        throw numberError;
      }
      return {type: Types.DOUBLE, unsigned: false, rawBuffer: false};
    case 'bigint':
      return {type: Types.VAR_STRING, unsigned: false, rawBuffer: false};
    case 'string':
      return {type: Types.VAR_STRING, unsigned: false, rawBuffer: false};
    default:
      var typeError = new TypeError('Unsupported query attribute type: ' + typeof value);
      typeError.code = 'QUERY_ATTRIBUTE_UNSUPPORTED_TYPE';
      throw typeError;
  }
}

function writeValue(writer, value, descriptor) {
  if (descriptor.rawBuffer) {
    writer.writeLengthCodedBuffer(value);
    return;
  }

  BinaryCodec.writeParameterValue(writer, value, descriptor);
}
