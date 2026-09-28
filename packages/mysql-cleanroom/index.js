'use strict';

var client = require('./lib/protocol/ClientPackets');
var server = require('./lib/protocol/ServerPackets');

exports.protocol = {
  capabilities: require('./lib/protocol/capabilities'),
  PacketFramer: require('./lib/protocol/PacketFramer').PacketFramer,
  PacketReader: require('./lib/protocol/PacketReader').PacketReader,
  encodePacket: require('./lib/protocol/PacketFramer').encodePacket,
  parseHandshakeV10: require('./lib/protocol/HandshakeV10').parseHandshakeV10,
  writeLengthEncodedInteger: client.writeLengthEncodedInteger,
  encodeHandshakeResponse41: client.encodeHandshakeResponse41,
  encodeQuery: client.encodeQuery,
  encodeQuit: client.encodeQuit,
  decodeErrorPacket: server.decodeErrorPacket,
  decodeOkPacket: server.decodeOkPacket,
  decodeAuthSwitchRequest: server.decodeAuthSwitchRequest,
  decodeColumnDefinition41: server.decodeColumnDefinition41,
  decodeTextRow: server.decodeTextRow
};
