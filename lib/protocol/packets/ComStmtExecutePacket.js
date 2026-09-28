'use strict';

var BinaryCodec = require('../BinaryCodec');
var Buffer = require('safe-buffer').Buffer;
var ClientConstants = require('../constants/client');
var QueryAttributeCodec = require('../QueryAttributeCodec');
var Types = require('../constants/types');

module.exports = ComStmtExecutePacket;

function ComStmtExecutePacket(statementId, values, attributes, clientFlags, cursorType) {
  this.statementId = statementId;
  this.values = values || [];
  this.attributes = attributes || {};
  this.clientFlags = clientFlags || 0;
  this.cursorType = cursorType || 0;
}

ComStmtExecutePacket.prototype.write = function write(writer) {
  var useQueryAttributes = Boolean(this.clientFlags & ClientConstants.CLIENT_QUERY_ATTRIBUTES);
  var attributeNames = useQueryAttributes ? Object.keys(this.attributes) : [];
  var parameterCount = this.values.length;
  var totalCount = parameterCount + attributeNames.length;
  var descriptors = [];

  writer.writeUnsignedNumber(1, 0x17);
  writer.writeUnsignedNumber(4, this.statementId);
  writer.writeUnsignedNumber(1, this.cursorType);
  writer.writeUnsignedNumber(4, 1);

  if (useQueryAttributes) {
    writer.writeLengthCodedNumber(totalCount);
  }

  if (totalCount === 0) {
    return;
  }

  var nullBitmap = Buffer.alloc(Math.ceil(totalCount / 8));

  for (var i = 0; i < totalCount; i++) {
    var isAttribute = i >= parameterCount;
    var value = isAttribute
      ? this.attributes[attributeNames[i - parameterCount]]
      : this.values[i];
    var descriptor = isAttribute
      ? QueryAttributeCodec.describe(value)
      : BinaryCodec.describeParameter(value);

    descriptors.push({
      descriptor  : descriptor,
      isAttribute : isAttribute,
      value       : value
    });

    if (isAttribute ? value === null : BinaryCodec.isNullParameter(value)) {
      nullBitmap[Math.floor(i / 8)] |= 1 << (i % 8);
    }
  }

  writer.writeBuffer(nullBitmap);
  writer.writeUnsignedNumber(1, 1);

  for (var index = 0; index < totalCount; index++) {
    var entry = descriptors[index];
    var type = entry.isAttribute
      ? entry.descriptor.type
      : wireType(entry.descriptor.type);

    writer.writeUnsignedNumber(1, type);
    writer.writeUnsignedNumber(1, entry.descriptor.unsigned ? 0x80 : 0x00);

    if (useQueryAttributes) {
      writer.writeLengthCodedString(index < parameterCount
        ? ''
        : attributeNames[index - parameterCount]);
    }
  }

  descriptors.forEach(function (entry) {
    if (entry.isAttribute) {
      QueryAttributeCodec.writeValue(writer, entry.value, entry.descriptor);
    } else {
      BinaryCodec.writeParameterValue(writer, entry.value, entry.descriptor);
    }
  });
};

function wireType(type) {
  if (type === Types.YEAR) {
    return Types.SHORT;
  }

  if (type === Types.BIT) {
    return Types.BLOB;
  }

  return type;
}
