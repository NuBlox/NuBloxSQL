'use strict';

var auth = require('./lib/protocol/Auth');
var client = require('./lib/protocol/ClientPackets');
var prepared = require('./lib/protocol/PreparedPackets');
var server = require('./lib/protocol/ServerPackets');

exports.protocol = {
  capabilities: require('./lib/protocol/capabilities'),
  types: prepared.types,
  PacketFramer: require('./lib/protocol/PacketFramer').PacketFramer,
  PacketReader: require('./lib/protocol/PacketReader').PacketReader,
  encodePacket: require('./lib/protocol/PacketFramer').encodePacket,
  parseHandshakeV10: require('./lib/protocol/HandshakeV10').parseHandshakeV10,
  writeLengthEncodedInteger: client.writeLengthEncodedInteger,
  encodeSslRequest: client.encodeSslRequest,
  encodeHandshakeResponse41: client.encodeHandshakeResponse41,
  encodeQuery: client.encodeQuery,
  encodeQuit: client.encodeQuit,
  decodeErrorPacket: server.decodeErrorPacket,
  decodeOkPacket: server.decodeOkPacket,
  decodeEofPacket: server.decodeEofPacket,
  decodeAuthSwitchRequest: server.decodeAuthSwitchRequest,
  decodeColumnDefinition41: server.decodeColumnDefinition41,
  decodeTextRow: server.decodeTextRow,
  encodePrepare: prepared.encodePrepare,
  decodePrepareOk: prepared.decodePrepareOk,
  encodeParameter: prepared.encodeParameter,
  encodeExecute: prepared.encodeExecute,
  encodeClose: prepared.encodeClose,
  encodeReset: prepared.encodeReset,
  decodeBinaryRow: prepared.decodeBinaryRow,
  mysqlNativePassword: auth.mysqlNativePassword,
  cachingSha2Password: auth.cachingSha2Password,
  cleartextPassword: auth.cleartextPassword,
  scramblePasswordForRsa: auth.scramblePasswordForRsa,
  encryptCachingSha2Password: auth.encryptCachingSha2Password
};

var runtime = require('./lib/TransactionConnection');
var pool = require('./lib/Pool');
exports.Connection = runtime.Connection;
exports.PreparedStatement = runtime.PreparedStatement;
exports.Pool = pool.Pool;
exports.MySqlError = require('./lib/Connection').MySqlError;
exports.createConnection = function createConnection(config) { return new runtime.Connection(config); };
exports.createPool = function createPool(config) { return new pool.Pool(config); };
