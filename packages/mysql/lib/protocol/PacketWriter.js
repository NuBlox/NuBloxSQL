var BIT_16               = Math.pow(2, 16);
var BIT_24               = Math.pow(2, 24);
var BUFFER_ALLOC_SIZE    = Math.pow(2, 8);
var PACKET_HEADER_LENGTH = 4;
// The maximum precision JS Numbers can hold precisely
// Don't panic: Good enough to represent byte values up to 8192 TB
var IEEE_754_BINARY_64_PRECISION = Math.pow(2, 53);
var MAX_PACKET_LENGTH            = Math.pow(2, 24) - 1;
var Buffer                       = require('safe-buffer').Buffer;

module.exports = PacketWriter;
function PacketWriter() {
  this._buffer = null;
  this._offset = 0;
}

PacketWriter.prototype.toBuffer = function toBuffer(parser) {
  if (!this._buffer) {
    this._buffer = Buffer.allocUnsafe(PACKET_HEADER_LENGTH);
    this._offset = 0;
  }

  var buffer = this._buffer;
  var length = this._offset;

  if (length < MAX_PACKET_LENGTH) {
    writeUInt24(buffer, 0, length);
    buffer[3] = parser.incrementPacketNumber();
    return buffer.slice(0, PACKET_HEADER_LENGTH + length);
  }

  var packets = Math.floor(length / MAX_PACKET_LENGTH) + 1;
  var framed = Buffer.allocUnsafe(length + packets * PACKET_HEADER_LENGTH);
  var framedOffset = 0;

  for (var packet = 0; packet < packets; packet++) {
    var isLast = (packet + 1 === packets);
    var packetLength = isLast
      ? length % MAX_PACKET_LENGTH
      : MAX_PACKET_LENGTH;

    writeUInt24(framed, framedOffset, packetLength);
    framed[framedOffset + 3] = parser.incrementPacketNumber();
    framedOffset += PACKET_HEADER_LENGTH;

    var start = PACKET_HEADER_LENGTH + packet * MAX_PACKET_LENGTH;
    var end = start + packetLength;

    buffer.copy(framed, framedOffset, start, end);
    framedOffset += packetLength;
  }

  this._buffer = framed;
  this._offset = framedOffset;

  return framed;
};

PacketWriter.prototype.writeUnsignedNumber = function(bytes, value) {
  this._allocate(bytes);

  for (var i = 0; i < bytes; i++) {
    this._buffer[PACKET_HEADER_LENGTH + this._offset++] = (value >> (i * 8)) & 0xff;
  }
};

PacketWriter.prototype.writeFiller = function(bytes) {
  this._allocate(bytes);

  var start = PACKET_HEADER_LENGTH + this._offset;
  this._buffer.fill(0x00, start, start + bytes);
  this._offset += bytes;
};

PacketWriter.prototype.writeNullTerminatedString = function(value, encoding) {
  // Typecast undefined into '' and numbers into strings
  value = value || '';
  value = value + '';

  var bytes = Buffer.byteLength(value, encoding || 'utf-8') + 1;
  this._allocate(bytes);

  var start = PACKET_HEADER_LENGTH + this._offset;
  this._buffer.write(value, start, encoding);
  this._buffer[start + bytes - 1] = 0x00;

  this._offset += bytes;
};

PacketWriter.prototype.writeString = function(value) {
  // Typecast undefined into '' and numbers into strings
  value = value || '';
  value = value + '';

  var bytes = Buffer.byteLength(value, 'utf-8');
  this._allocate(bytes);

  this._buffer.write(value, PACKET_HEADER_LENGTH + this._offset, 'utf-8');

  this._offset += bytes;
};

PacketWriter.prototype.writeBuffer = function(value) {
  var bytes = value.length;

  this._allocate(bytes);
  value.copy(this._buffer, PACKET_HEADER_LENGTH + this._offset);
  this._offset += bytes;
};

PacketWriter.prototype.writeLengthCodedNumber = function(value) {
  if (value === null) {
    this._allocate(1);
    this._buffer[PACKET_HEADER_LENGTH + this._offset++] = 251;
    return;
  }

  if (value <= 250) {
    this._allocate(1);
    this._buffer[PACKET_HEADER_LENGTH + this._offset++] = value;
    return;
  }

  if (value > IEEE_754_BINARY_64_PRECISION) {
    throw new Error(
      'writeLengthCodedNumber: JS precision range exceeded, your ' +
      'number is > 53 bit: "' + value + '"'
    );
  }

  if (value < BIT_16) {
    this._allocate(3);
    this._buffer[PACKET_HEADER_LENGTH + this._offset++] = 252;
  } else if (value < BIT_24) {
    this._allocate(4);
    this._buffer[PACKET_HEADER_LENGTH + this._offset++] = 253;
  } else {
    this._allocate(9);
    this._buffer[PACKET_HEADER_LENGTH + this._offset++] = 254;
  }

  // 16 Bit
  this._buffer[PACKET_HEADER_LENGTH + this._offset++] = value & 0xff;
  this._buffer[PACKET_HEADER_LENGTH + this._offset++] = (value >> 8) & 0xff;

  if (value < BIT_16) {
    return;
  }

  // 24 Bit
  this._buffer[PACKET_HEADER_LENGTH + this._offset++] = (value >> 16) & 0xff;

  if (value < BIT_24) {
    return;
  }

  this._buffer[PACKET_HEADER_LENGTH + this._offset++] = (value >> 24) & 0xff;

  // Hack: Get the most significant 32 bit (JS bitwise operators are 32 bit)
  value = value.toString(2);
  value = value.substr(0, value.length - 32);
  value = parseInt(value, 2);

  this._buffer[PACKET_HEADER_LENGTH + this._offset++] = value & 0xff;
  this._buffer[PACKET_HEADER_LENGTH + this._offset++] = (value >> 8) & 0xff;
  this._buffer[PACKET_HEADER_LENGTH + this._offset++] = (value >> 16) & 0xff;

  // Set last byte to 0, as we can only support 53 bits in JS (see above)
  this._buffer[PACKET_HEADER_LENGTH + this._offset++] = 0;
};

PacketWriter.prototype.writeLengthCodedBuffer = function(value) {
  var bytes = value.length;
  this.writeLengthCodedNumber(bytes);
  this.writeBuffer(value);
};

PacketWriter.prototype.writeNullTerminatedBuffer = function(value) {
  this.writeBuffer(value);
  this.writeFiller(1); // 0x00 terminator
};

PacketWriter.prototype.writeLengthCodedString = function(value) {
  if (value === null) {
    this.writeLengthCodedNumber(null);
    return;
  }

  value = (value === undefined)
    ? ''
    : String(value);

  var bytes = Buffer.byteLength(value, 'utf-8');
  this.writeLengthCodedNumber(bytes);

  if (!bytes) {
    return;
  }

  this._allocate(bytes);
  this._buffer.write(value, PACKET_HEADER_LENGTH + this._offset, 'utf-8');
  this._offset += bytes;
};

PacketWriter.prototype._allocate = function _allocate(bytes) {
  var required = PACKET_HEADER_LENGTH + this._offset + bytes;

  if (!this._buffer) {
    this._buffer = Buffer.allocUnsafe(Math.max(BUFFER_ALLOC_SIZE + PACKET_HEADER_LENGTH, required));
    this._offset = 0;
    return;
  }

  if (this._buffer.length >= required) {
    return;
  }

  var oldBuffer = this._buffer;
  var newSize = Math.max(BUFFER_ALLOC_SIZE + PACKET_HEADER_LENGTH, required, oldBuffer.length * 2);

  this._buffer = Buffer.allocUnsafe(newSize);
  oldBuffer.copy(this._buffer, 0, 0, PACKET_HEADER_LENGTH + this._offset);
};

function writeUInt24(buffer, offset, value) {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >>> 8) & 0xff;
  buffer[offset + 2] = (value >>> 16) & 0xff;
}
