'use strict';

var BinaryCodec = require('../BinaryCodec');
var Buffer = require('safe-buffer').Buffer;

module.exports = ComStmtExecutePacket;

function ComStmtExecutePacket(statementId, values) {
  this.statementId = statementId;
  this.values = values || [];
}

ComStmtExecutePacket.prototype.write = function write(writer) {
  var descriptors = [];
  var nullBitmap = Buffer.alloc(Math.ceil(this.values.length / 8));

  writer.writeUnsignedNumber(1, 0x17);
  writer.writeUnsignedNumber(4, this.statementId);
  writer.writeUnsignedNumber(1, 0x00);
  writer.writeUnsignedNumber(4, 1);

  if (this.values.length === 0) {
    return;
  }

  for (var i = 0; i < this.values.length; i++) {
    var descriptor = BinaryCodec.describeParameter(this.values[i]);
    descriptors.push(descriptor);

    if (BinaryCodec.isNullParameter(this.values[i])) {
      nullBitmap[Math.floor(i / 8)] |= 1 << (i % 8);
    }
  }

  writer.writeBuffer(nullBitmap);
  writer.writeUnsignedNumber(1, 1);

  descriptors.forEach(function (descriptor) {
    writer.writeUnsignedNumber(1, descriptor.type);
    writer.writeUnsignedNumber(1, descriptor.unsigned ? 0x80 : 0x00);
  });

  for (var index = 0; index < this.values.length; index++) {
    BinaryCodec.writeParameterValue(writer, this.values[index], descriptors[index]);
  }
};
