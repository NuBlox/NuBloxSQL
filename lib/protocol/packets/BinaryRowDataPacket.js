'use strict';

var BinaryCodec = require('../BinaryCodec');

module.exports = BinaryRowDataPacket;

function BinaryRowDataPacket() {
}

Object.defineProperty(BinaryRowDataPacket.prototype, 'parse', {
  configurable : true,
  enumerable   : false,
  value        : parse
});

function parse(parser, fieldPackets, typeCast, nestTables, connection) {
  var header = parser.parseUnsignedNumber(1);

  if (header !== 0x00) {
    var error = new Error('Invalid binary row header: ' + header);
    error.code = 'PREPARED_STATEMENT_INVALID_BINARY_ROW';
    throw error;
  }

  var nullBitmap = parser.parseBuffer(Math.floor((fieldPackets.length + 9) / 8));

  for (var i = 0; i < fieldPackets.length; i++) {
    var fieldPacket = fieldPackets[i];
    var byte = Math.floor((i + 2) / 8);
    var bit = (i + 2) % 8;
    var isNull = Boolean(nullBitmap[byte] & (1 << bit));
    var value = isNull ? null : BinaryCodec.parseValue(parser, fieldPacket, connection);

    if (typeof nestTables === 'string' && nestTables.length) {
      this[fieldPacket.table + nestTables + fieldPacket.name] = value;
    } else if (nestTables) {
      this[fieldPacket.table] = this[fieldPacket.table] || {};
      this[fieldPacket.table][fieldPacket.name] = value;
    } else {
      this[fieldPacket.name] = value;
    }
  }
}
