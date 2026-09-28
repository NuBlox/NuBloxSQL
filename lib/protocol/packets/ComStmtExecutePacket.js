'use strict';

var BinaryCodec = require('../BinaryCodec');
var Buffer = require('safe-buffer').Buffer;
var ClientConstants = require('../constants/client');
var Types = require('../constants/types');

module.exports = ComStmtExecutePacket;

function ComStmtExecutePacket(statementId, values, attributes, clientFlags) {
  this.statementId = statementId;
  this.values = values || [];
  this.attributes = attributes || {};
  this.clientFlags = clientFlags || 0;
}

ComStmtExecutePacket.prototype.write = function write(writer) {
  var useQueryAttributes = Boolean(this.clientFlags & ClientConstants.CLIENT_QUERY_ATTRIBUTES);
  var attributeNames = useQueryAttributes ? Object.keys(this.attributes) : [];
  var parameterCount = this.values.length;
  var totalCount = parameterCount + attributeNames.length;
  var allValues = this.values.slice();
  var descriptors = [];

  attributeNames.forEach(function (name) {
    allValues.push(this.attributes[name]);
  }, this);

  writer.writeUnsignedNumber(1, 0x17);
  writer.writeUnsignedNumber(4, this.statementId);
  writer.writeUnsignedNumber(1, useQueryAttributes ? 0x08 : 0x00);
  writer.writeUnsignedNumber(4, 1);

  if (useQueryAttributes) {
    writer.writeLengthCodedNumber(totalCount);
  }

  if (totalCount === 0) {
    return;
  }

  var nullBitmap = Buffer.alloc(Math.ceil(totalCount / 8));

  for (var i = 0; i < totalCount; i++) {
    var descriptor = BinaryCodec.describeParameter(allValues[i]);
    descriptors.push(descriptor);

    if (BinaryCodec.isNullParameter(allValues[i])) {
      nullBitmap[Math.floor(i / 8)] |= 1 << (i % 8);
    }
  }

  writer.writeBuffer(nullBitmap);
  writer.writeUnsignedNumber(1, 1);

  for (var index = 0; index < totalCount; index++) {
    writer.writeUnsignedNumber(1, wireType(descriptors[index].type));
    writer.writeUnsignedNumber(1, descriptors[index].unsigned ? 0x80 : 0x00);

    if (useQueryAttributes) {
      writer.writeLengthCodedString(index < parameterCount
        ? ''
        : attributeNames[index - parameterCount]);
    }
  }

  for (var valueIndex = 0; valueIndex < totalCount; valueIndex++) {
    BinaryCodec.writeParameterValue(writer, allValues[valueIndex], descriptors[valueIndex]);
  }
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
