'use strict';

var HEADER_BYTES = 4;
var MAX_PAYLOAD_BYTES = 0xFFFFFF;

function encodePacket(payload, sequenceId) {
  if (!Buffer.isBuffer(payload)) payload = Buffer.from(payload || []);
  if (payload.length > MAX_PAYLOAD_BYTES) throw new RangeError('MySQL packet payload exceeds 16,777,215 bytes');
  if (!Number.isInteger(sequenceId) || sequenceId < 0 || sequenceId > 255) {
    throw new RangeError('MySQL packet sequenceId must be an integer from 0 to 255');
  }

  var packet = Buffer.allocUnsafe(HEADER_BYTES + payload.length);
  packet[0] = payload.length & 0xFF;
  packet[1] = (payload.length >>> 8) & 0xFF;
  packet[2] = (payload.length >>> 16) & 0xFF;
  packet[3] = sequenceId;
  payload.copy(packet, HEADER_BYTES);
  return packet;
}

function PacketFramer(options) {
  options = options || {};
  this.maxPayloadBytes = options.maxPayloadBytes === undefined ? MAX_PAYLOAD_BYTES : options.maxPayloadBytes;
  if (!Number.isInteger(this.maxPayloadBytes) || this.maxPayloadBytes < 0 || this.maxPayloadBytes > MAX_PAYLOAD_BYTES) {
    throw new RangeError('maxPayloadBytes must be an integer from 0 to 16,777,215');
  }
  this.buffer = Buffer.alloc(0);
}

PacketFramer.prototype.push = function push(chunk) {
  if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk || []);
  if (!chunk.length) return [];

  this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
  var packets = [];
  var offset = 0;

  while (this.buffer.length - offset >= HEADER_BYTES) {
    var payloadLength = this.buffer[offset]
      | (this.buffer[offset + 1] << 8)
      | (this.buffer[offset + 2] << 16);

    if (payloadLength > this.maxPayloadBytes) {
      throw new RangeError('MySQL packet payload exceeds configured limit');
    }

    var packetLength = HEADER_BYTES + payloadLength;
    if (this.buffer.length - offset < packetLength) break;

    packets.push({
      sequenceId: this.buffer[offset + 3],
      payload: this.buffer.subarray(offset + HEADER_BYTES, offset + packetLength)
    });
    offset += packetLength;
  }

  if (offset) this.buffer = this.buffer.subarray(offset);
  return packets;
};

PacketFramer.prototype.reset = function reset() {
  this.buffer = Buffer.alloc(0);
};

exports.HEADER_BYTES = HEADER_BYTES;
exports.MAX_PAYLOAD_BYTES = MAX_PAYLOAD_BYTES;
exports.PacketFramer = PacketFramer;
exports.encodePacket = encodePacket;
