'use strict';

var PacketReader = require('./PacketReader').PacketReader;

function decodeErrorPacket(payload) {
  var reader = new PacketReader(payload);
  if (reader.uint8() !== 0xff) throw new RangeError('Not a MySQL ERR packet');
  var code = reader.uint16LE();
  var sqlState = null;
  if (reader.remaining() && reader.buffer[reader.offset] === 0x23) {
    reader.skip(1);
    sqlState = reader.bytes(5).toString('ascii');
  }
  return { code: code, sqlState: sqlState, message: reader.bytes(reader.remaining()).toString('utf8') };
}

function decodeOkPacket(payload) {
  var reader = new PacketReader(payload);
  if (reader.uint8() !== 0x00) throw new RangeError('Not a MySQL OK packet');
  var affectedRows = reader.lengthEncodedInteger();
  var lastInsertId = reader.lengthEncodedInteger();
  var statusFlags = reader.remaining() >= 2 ? reader.uint16LE() : 0;
  var warnings = reader.remaining() >= 2 ? reader.uint16LE() : 0;
  return { affectedRows: affectedRows, lastInsertId: lastInsertId, statusFlags: statusFlags, warnings: warnings };
}

function decodeEofPacket(payload) {
  var reader = new PacketReader(payload);
  if (reader.uint8() !== 0xfe || payload.length >= 9) throw new RangeError('Not a MySQL EOF packet');
  var warnings = reader.remaining() >= 2 ? reader.uint16LE() : 0;
  var statusFlags = reader.remaining() >= 2 ? reader.uint16LE() : 0;
  return { warnings: warnings, statusFlags: statusFlags };
}

function decodeAuthSwitchRequest(payload) {
  var reader = new PacketReader(payload);
  if (reader.uint8() !== 0xfe) throw new RangeError('Not a MySQL AuthSwitchRequest packet');
  var pluginName = reader.nullTerminatedString('utf8');
  var pluginData = reader.bytes(reader.remaining());
  if (pluginData.length && pluginData[pluginData.length - 1] === 0) pluginData = pluginData.subarray(0, pluginData.length - 1);
  return { pluginName: pluginName, pluginData: pluginData };
}

function decodeColumnDefinition41(payload) {
  var reader = new PacketReader(payload);
  var catalog = reader.lengthEncodedString('utf8');
  var schema = reader.lengthEncodedString('utf8');
  var table = reader.lengthEncodedString('utf8');
  var originalTable = reader.lengthEncodedString('utf8');
  var name = reader.lengthEncodedString('utf8');
  var originalName = reader.lengthEncodedString('utf8');
  var fixedLength = reader.lengthEncodedInteger();
  if (fixedLength !== 0x0c) throw new RangeError('Invalid MySQL ColumnDefinition41 fixed field length');
  var characterSet = reader.uint16LE();
  var columnLength = reader.uint32LE();
  var type = reader.uint8();
  var flags = reader.uint16LE();
  var decimals = reader.uint8();
  reader.skip(2);
  return { catalog: catalog, schema: schema, table: table, originalTable: originalTable, name: name, originalName: originalName, characterSet: characterSet, columnLength: columnLength, type: type, flags: flags, decimals: decimals };
}

function decodeTextRow(payload, fields) {
  var reader = new PacketReader(payload);
  var row = Object.create(null);
  for (var i = 0; i < fields.length; i++) row[fields[i].name] = reader.lengthEncodedString('utf8');
  if (reader.remaining()) throw new RangeError('Trailing bytes in MySQL text row');
  return row;
}

exports.decodeErrorPacket = decodeErrorPacket;
exports.decodeOkPacket = decodeOkPacket;
exports.decodeEofPacket = decodeEofPacket;
exports.decodeAuthSwitchRequest = decodeAuthSwitchRequest;
exports.decodeColumnDefinition41 = decodeColumnDefinition41;
exports.decodeTextRow = decodeTextRow;
