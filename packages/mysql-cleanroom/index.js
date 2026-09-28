'use strict';

exports.protocol = {
  capabilities: require('./lib/protocol/capabilities'),
  PacketFramer: require('./lib/protocol/PacketFramer').PacketFramer,
  PacketReader: require('./lib/protocol/PacketReader').PacketReader,
  encodePacket: require('./lib/protocol/PacketFramer').encodePacket,
  parseHandshakeV10: require('./lib/protocol/HandshakeV10').parseHandshakeV10
};
