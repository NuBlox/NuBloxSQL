'use strict';

var auth = require('./lib/protocol/Auth');
var client = require('./lib/protocol/ClientPackets');
var prepared = require('./lib/protocol/PreparedPackets');
var server = require('./lib/protocol/ServerPackets');
var descriptor = require('./lib/SqlDialectDescriptor');
var authPlugins = require('./lib/AuthPlugins');

exports.protocol = {
  capabilities: require('./lib/protocol/capabilities'),
  types: prepared.types,
  PacketFramer: require('./lib/protocol/PacketFramer').PacketFramer,
  PacketReader: require('./lib/protocol/PacketReader').PacketReader,
  encodePacket: require('./lib/protocol/PacketFramer').encodePacket,
  parseHandshakeV10: require('./lib/protocol/HandshakeV10').parseHandshakeV10,
  writeLengthEncodedInteger: client.writeLengthEncodedInteger,
  writeLengthEncodedString: client.writeLengthEncodedString,
  encodeConnectionAttributes: client.encodeConnectionAttributes,
  encodeSslRequest: client.encodeSslRequest,
  encodeHandshakeResponse41: client.encodeHandshakeResponse41,
  encodeQuery: client.encodeQuery,
  encodeQuit: client.encodeQuit,
  encodeResetConnection: client.encodeResetConnection,
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
  encryptSha2Password: auth.encryptSha2Password,
  encryptCachingSha2Password: auth.encryptCachingSha2Password
};

var runtime = require('./lib/StreamingConnection');
authPlugins.install(runtime);
require('./lib/PreparedStreaming').install(runtime);
var pool = require('./lib/Pool');
require('./lib/LocalInfilePool').install(pool);
var diagnostics = require('./lib/Diagnostics');
diagnostics.install(runtime, pool);
var ResultStream = require('./lib/ResultStream').ResultStream;
var errorModel = require('./lib/ErrorModel');
var observability = require('./lib/Observability');
var baseConnection = require('./lib/Connection');
errorModel.install(runtime, pool, ResultStream);
observability.install(runtime, pool);
exports.descriptor = descriptor;
exports.capabilities = descriptor.capabilities;
exports.services = descriptor.services;
exports.Connection = runtime.Connection;
exports.PreparedStatement = runtime.PreparedStatement;
exports.ResultStream = ResultStream;
exports.Pool = pool.Pool;
exports.MySqlError = baseConnection.MySqlError;
exports.MySqlClientError = errorModel.MySqlClientError;
exports.MySqlResultLimitError = runtime.MySqlResultLimitError;
exports.ERROR_CODES = errorModel.CODES;
exports.DEFAULT_LIMITS = runtime.DEFAULT_LIMITS;
exports.DEFAULT_LOCAL_INFILE_MAX_BYTES = baseConnection.DEFAULT_LOCAL_INFILE_MAX_BYTES;
exports.DEFAULT_LOCAL_INFILE_CHUNK_BYTES = baseConnection.DEFAULT_LOCAL_INFILE_CHUNK_BYTES;
exports.MAX_CONNECTION_ATTRIBUTES_BYTES = client.MAX_CONNECTION_ATTRIBUTES_BYTES;
exports.OBSERVABILITY_CHANNELS = observability.CHANNEL_NAMES;
exports.AUTHENTICATION_PLUGINS = authPlugins.AUTHENTICATION_PLUGINS;
exports.authenticationPlugin = authPlugins.authenticationPlugin;
exports.authenticationPluginReport = authPlugins.authenticationPluginReport;
exports.createConnection = function createConnection(config) { return new runtime.Connection(config); };
exports.createPool = function createPool(config) { return new pool.Pool(config); };
