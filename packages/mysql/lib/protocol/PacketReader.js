'use strict';

function PacketReader(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('PacketReader requires a Buffer');
  this.buffer = buffer;
  this.offset = 0;
}

PacketReader.prototype.remaining = function remaining() {
  return this.buffer.length - this.offset;
};

PacketReader.prototype.require = function requireBytes(count) {
  if (!Number.isInteger(count) || count < 0) throw new RangeError('count must be a non-negative integer');
  if (this.remaining() < count) throw new RangeError('Unexpected end of MySQL packet');
};

PacketReader.prototype.uint8 = function uint8() {
  this.require(1);
  return this.buffer[this.offset++];
};

PacketReader.prototype.uint16LE = function uint16LE() {
  this.require(2);
  var value = this.buffer.readUInt16LE(this.offset);
  this.offset += 2;
  return value;
};

PacketReader.prototype.uint24LE = function uint24LE() {
  this.require(3);
  var value = this.buffer[this.offset]
    | (this.buffer[this.offset + 1] << 8)
    | (this.buffer[this.offset + 2] << 16);
  this.offset += 3;
  return value >>> 0;
};

PacketReader.prototype.uint32LE = function uint32LE() {
  this.require(4);
  var value = this.buffer.readUInt32LE(this.offset);
  this.offset += 4;
  return value;
};

PacketReader.prototype.uint64LE = function uint64LE() {
  this.require(8);
  var value = this.buffer.readBigUInt64LE(this.offset);
  this.offset += 8;
  return value;
};

PacketReader.prototype.bytes = function bytes(count) {
  this.require(count);
  var value = this.buffer.subarray(this.offset, this.offset + count);
  this.offset += count;
  return value;
};

PacketReader.prototype.skip = function skip(count) {
  this.require(count);
  this.offset += count;
};

PacketReader.prototype.nullTerminatedBuffer = function nullTerminatedBuffer() {
  var end = this.buffer.indexOf(0, this.offset);
  if (end === -1) throw new RangeError('Missing NUL terminator in MySQL packet');
  var value = this.buffer.subarray(this.offset, end);
  this.offset = end + 1;
  return value;
};

PacketReader.prototype.nullTerminatedString = function nullTerminatedString(encoding) {
  return this.nullTerminatedBuffer().toString(encoding || 'utf8');
};

PacketReader.prototype.lengthEncodedInteger = function lengthEncodedInteger() {
  var first = this.uint8();
  if (first < 0xFB) return first;
  if (first === 0xFB) return null;
  if (first === 0xFC) return this.uint16LE();
  if (first === 0xFD) return this.uint24LE();
  if (first === 0xFE) {
    var value = this.uint64LE();
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
  }
  throw new RangeError('Invalid MySQL length-encoded integer marker: 0x' + first.toString(16));
};

PacketReader.prototype.lengthEncodedBuffer = function lengthEncodedBuffer() {
  var length = this.lengthEncodedInteger();
  if (length === null) return null;
  if (typeof length === 'bigint') {
    if (length > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Length-encoded value is too large');
    length = Number(length);
  }
  return this.bytes(length);
};

PacketReader.prototype.lengthEncodedString = function lengthEncodedString(encoding) {
  var value = this.lengthEncodedBuffer();
  return value === null ? null : value.toString(encoding || 'utf8');
};

exports.PacketReader = PacketReader;
