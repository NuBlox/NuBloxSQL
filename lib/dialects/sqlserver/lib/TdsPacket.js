'use strict';

var HEADER_LENGTH = 8;
var MAX_PACKET_LENGTH = 32767;
var DEFAULT_PACKET_SIZE = 4096;

var PACKET_TYPES = Object.freeze({
  SQL_BATCH: 0x01,
  RPC: 0x03,
  RESPONSE: 0x04,
  ATTENTION: 0x06,
  BULK_LOAD: 0x07,
  FEDAUTH_TOKEN: 0x08,
  TRANSACTION_MANAGER: 0x0e,
  LOGIN7: 0x10,
  SSPI: 0x11,
  PRELOGIN: 0x12
});

var STATUS = Object.freeze({
  EOM: 0x01,
  IGNORE: 0x02,
  RESET_CONNECTION: 0x08,
  RESET_CONNECTION_SKIP_TRAN: 0x10
});

function assertByte(value, name) {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) throw new RangeError(name + ' must be an unsigned byte');
  return value;
}

function encodePacket(options) {
  options = options || {};
  var payload = options.payload === undefined ? Buffer.alloc(0) : Buffer.from(options.payload);
  var length = HEADER_LENGTH + payload.length;
  if (length > MAX_PACKET_LENGTH) throw new RangeError('TDS packet exceeds maximum length of ' + MAX_PACKET_LENGTH + ' bytes');
  var packet = Buffer.allocUnsafe(length);
  packet[0] = assertByte(options.type, 'TDS packet type');
  packet[1] = assertByte(options.status === undefined ? STATUS.EOM : options.status, 'TDS packet status');
  packet.writeUInt16BE(length, 2);
  packet.writeUInt16BE(options.spid === undefined ? 0 : options.spid, 4);
  packet[6] = assertByte(options.packetId === undefined ? 1 : options.packetId, 'TDS packet id');
  packet[7] = assertByte(options.window === undefined ? 0 : options.window, 'TDS packet window');
  payload.copy(packet, HEADER_LENGTH);
  return packet;
}

function decodePacket(buffer) {
  buffer = Buffer.from(buffer);
  if (buffer.length < HEADER_LENGTH) throw new RangeError('Incomplete TDS packet header');
  var length = buffer.readUInt16BE(2);
  if (length < HEADER_LENGTH) throw new RangeError('Invalid TDS packet length');
  if (length > MAX_PACKET_LENGTH) throw new RangeError('TDS packet length exceeds protocol maximum');
  if (buffer.length < length) throw new RangeError('Incomplete TDS packet payload');
  return Object.freeze({
    type: buffer[0],
    status: buffer[1],
    length: length,
    spid: buffer.readUInt16BE(4),
    packetId: buffer[6],
    window: buffer[7],
    payload: buffer.subarray(HEADER_LENGTH, length),
    bytesConsumed: length,
    endOfMessage: (buffer[1] & STATUS.EOM) !== 0
  });
}

function packetize(type, payload, options) {
  options = options || {};
  payload = Buffer.from(payload || []);
  var packetSize = options.packetSize === undefined ? DEFAULT_PACKET_SIZE : options.packetSize;
  if (!Number.isInteger(packetSize) || packetSize < 512 || packetSize > MAX_PACKET_LENGTH) {
    throw new RangeError('TDS packetSize must be an integer between 512 and ' + MAX_PACKET_LENGTH);
  }
  var payloadSize = packetSize - HEADER_LENGTH;
  var packets = [];
  var offset = 0;
  var packetId = options.packetId === undefined ? 1 : assertByte(options.packetId, 'TDS packet id');
  if (payload.length === 0) return [encodePacket({ type: type, status: STATUS.EOM, packetId: packetId, spid: options.spid || 0 })];
  while (offset < payload.length) {
    var end = Math.min(offset + payloadSize, payload.length);
    var finalPacket = end === payload.length;
    packets.push(encodePacket({
      type: type,
      status: finalPacket ? STATUS.EOM : 0,
      packetId: packetId,
      spid: options.spid || 0,
      window: options.window || 0,
      payload: payload.subarray(offset, end)
    }));
    packetId = (packetId + 1) & 0xff;
    offset = end;
  }
  return packets;
}

function PacketParser() {
  this._buffer = Buffer.alloc(0);
}

PacketParser.prototype.push = function push(chunk) {
  if (!chunk || chunk.length === 0) return [];
  this._buffer = this._buffer.length ? Buffer.concat([this._buffer, Buffer.from(chunk)]) : Buffer.from(chunk);
  var packets = [];
  while (this._buffer.length >= HEADER_LENGTH) {
    var length = this._buffer.readUInt16BE(2);
    if (length < HEADER_LENGTH || length > MAX_PACKET_LENGTH) throw new RangeError('Invalid TDS packet length: ' + length);
    if (this._buffer.length < length) break;
    packets.push(decodePacket(this._buffer.subarray(0, length)));
    this._buffer = this._buffer.subarray(length);
  }
  return packets;
};

PacketParser.prototype.bufferedBytes = function bufferedBytes() { return this._buffer.length; };

exports.HEADER_LENGTH = HEADER_LENGTH;
exports.MAX_PACKET_LENGTH = MAX_PACKET_LENGTH;
exports.DEFAULT_PACKET_SIZE = DEFAULT_PACKET_SIZE;
exports.PACKET_TYPES = PACKET_TYPES;
exports.STATUS = STATUS;
exports.encodePacket = encodePacket;
exports.decodePacket = decodePacket;
exports.packetize = packetize;
exports.PacketParser = PacketParser;
