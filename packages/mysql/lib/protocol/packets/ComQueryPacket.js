'use strict';

var Buffer = require('safe-buffer').Buffer;
var ClientConstants = require('../constants/client');
var QueryAttributeCodec = require('../QueryAttributeCodec');

module.exports = ComQueryPacket;

function ComQueryPacket(sql, attributes, clientFlags) {
  this.command = 0x03;
  this.sql = sql;
  this.attributes = attributes || {};
  this.clientFlags = clientFlags || 0;
}

ComQueryPacket.prototype.write = function write(writer) {
  var useQueryAttributes = Boolean(this.clientFlags & ClientConstants.CLIENT_QUERY_ATTRIBUTES);

  writer.writeUnsignedNumber(1, this.command);

  if (!useQueryAttributes) {
    writer.writeString(this.sql);
    return;
  }

  var names = Object.keys(this.attributes);
  var descriptors = [];
  var nullBitmap = Buffer.alloc(Math.ceil(names.length / 8));

  writer.writeLengthCodedNumber(names.length);
  writer.writeLengthCodedNumber(1);

  if (names.length > 0) {
    for (var i = 0; i < names.length; i++) {
      var value = this.attributes[names[i]];
      var descriptor = QueryAttributeCodec.describe(value);
      descriptors.push(descriptor);

      if (value === null) {
        nullBitmap[Math.floor(i / 8)] |= 1 << (i % 8);
      }
    }

    writer.writeBuffer(nullBitmap);
    writer.writeUnsignedNumber(1, 1);

    for (var index = 0; index < names.length; index++) {
      writer.writeUnsignedNumber(1, descriptors[index].type);
      writer.writeUnsignedNumber(1, descriptors[index].unsigned ? 0x80 : 0x00);
      writer.writeLengthCodedString(names[index]);
    }

    for (var valueIndex = 0; valueIndex < names.length; valueIndex++) {
      QueryAttributeCodec.writeValue(
        writer,
        this.attributes[names[valueIndex]],
        descriptors[valueIndex]
      );
    }
  }

  writer.writeString(this.sql);
};

ComQueryPacket.prototype.parse = function parse(parser) {
  this.command = parser.parseUnsignedNumber(1);
  this.sql = parser.parsePacketTerminatedString();
};
