'use strict';

var Buffer = require('safe-buffer').Buffer;
var Zlib = require('zlib');

var HEADER_LENGTH = 7;
var MAX_PAYLOAD_LENGTH = Math.pow(2, 24) - 1;

module.exports = CompressedProtocol;

function CompressedProtocol() {
  this._active = false;
  this._algorithm = null;
  this._buffer = Buffer.alloc(0);
  this._nextPacketNumber = 0;
}

CompressedProtocol.prototype.active = function active() {
  return this._active;
};

CompressedProtocol.prototype.algorithm = function algorithm() {
  return this._algorithm;
};

CompressedProtocol.prototype.activate = function activate(algorithm) {
  if (algorithm !== 'zlib') {
    var error = new Error('Unsupported compression algorithm: ' + algorithm);
    error.code = 'PROTOCOL_COMPRESSION_UNSUPPORTED_ALGORITHM';
    error.fatal = true;
    throw error;
  }

  this._active = true;
  this._algorithm = algorithm;
  this._buffer = Buffer.alloc(0);
  this.resetPacketNumber();
};

CompressedProtocol.prototype.resetPacketNumber = function resetPacketNumber() {
  this._nextPacketNumber = 0;
};

CompressedProtocol.prototype.encode = function encode(buffer) {
  if (!this._active) {
    return buffer;
  }

  var frames = [];

  for (var start = 0; start < buffer.length; start += MAX_PAYLOAD_LENGTH) {
    var chunk = buffer.slice(start, Math.min(start + MAX_PAYLOAD_LENGTH, buffer.length));
    frames.push(this._encodeFrame(chunk));
  }

  if (frames.length === 0) {
    frames.push(this._encodeFrame(Buffer.alloc(0)));
  }

  return frames.length === 1 ? frames[0] : Buffer.concat(frames);
};

CompressedProtocol.prototype.write = function write(chunk, onPayload) {
  if (!this._active) {
    onPayload(chunk);
    return;
  }

  if (!chunk || chunk.length === 0) {
    return;
  }

  this._buffer = this._buffer.length === 0
    ? chunk
    : Buffer.concat([this._buffer, chunk]);

  while (this._buffer.length >= HEADER_LENGTH) {
    var payloadLength = readUInt24(this._buffer, 0);
    var frameLength = HEADER_LENGTH + payloadLength;

    if (this._buffer.length < frameLength) {
      return;
    }

    var sequenceId = this._buffer[3];
    if (sequenceId !== this._nextPacketNumber) {
      throw compressionError(
        'Compressed packets out of order. Got: ' + sequenceId + ' Expected: ' + this._nextPacketNumber,
        'PROTOCOL_COMPRESSED_PACKETS_OUT_OF_ORDER'
      );
    }

    this._nextPacketNumber = (this._nextPacketNumber + 1) % 256;

    var uncompressedLength = readUInt24(this._buffer, 4);
    var payload = this._buffer.slice(HEADER_LENGTH, frameLength);
    var decoded = payload;

    if (uncompressedLength !== 0) {
      try {
        decoded = Zlib.inflateSync(payload, {
          maxOutputLength: uncompressedLength
        });
      } catch (error) {
        error.code = 'PROTOCOL_COMPRESSION_INFLATE_ERROR';
        error.fatal = true;
        throw error;
      }

      if (decoded.length !== uncompressedLength) {
        throw compressionError(
          'Compressed packet expanded to ' + decoded.length + ' bytes; expected ' + uncompressedLength,
          'PROTOCOL_COMPRESSION_LENGTH_MISMATCH'
        );
      }
    }

    this._buffer = this._buffer.slice(frameLength);
    onPayload(decoded);
  }
};

CompressedProtocol.prototype._encodeFrame = function _encodeFrame(buffer) {
  var compressed;

  try {
    compressed = Zlib.deflateSync(buffer);
  } catch (error) {
    error.code = 'PROTOCOL_COMPRESSION_DEFLATE_ERROR';
    error.fatal = true;
    throw error;
  }

  var useCompressed = compressed.length < buffer.length && compressed.length <= MAX_PAYLOAD_LENGTH;
  var payload = useCompressed ? compressed : buffer;
  var header = Buffer.allocUnsafe(HEADER_LENGTH);

  writeUInt24(header, payload.length, 0);
  header[3] = this._nextPacketNumber;
  writeUInt24(header, useCompressed ? buffer.length : 0, 4);
  this._nextPacketNumber = (this._nextPacketNumber + 1) % 256;

  return Buffer.concat([header, payload]);
};

function readUInt24(buffer, offset) {
  return buffer[offset] |
    (buffer[offset + 1] << 8) |
    (buffer[offset + 2] << 16);
}

function writeUInt24(buffer, value, offset) {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >>> 8) & 0xff;
  buffer[offset + 2] = (value >>> 16) & 0xff;
}

function compressionError(message, code) {
  var error = new Error(message);
  error.code = code;
  error.fatal = true;
  return error;
}
