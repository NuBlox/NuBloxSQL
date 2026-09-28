'use strict';

var Buffer = require('safe-buffer').Buffer;

var HEADER_LENGTH = 4;
var MAX_FRAGMENT_LENGTH = Math.pow(2, 24) - 1;

module.exports = InboundPacketLimiter;

function InboundPacketLimiter(maxBytes) {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError('maxBytes must be a positive integer');
  }

  this._maxBytes = maxBytes;
  this._header = Buffer.allocUnsafe(HEADER_LENGTH);
  this._headerOffset = 0;
  this._payloadRemaining = 0;
  this._currentFragmentLength = 0;
  this._logicalPacketBytes = 0;
}

InboundPacketLimiter.prototype.write = function write(chunk) {
  if (!chunk || chunk.length === 0) {
    return;
  }

  var offset = 0;

  while (offset < chunk.length) {
    if (this._payloadRemaining === 0) {
      while (this._headerOffset < HEADER_LENGTH && offset < chunk.length) {
        this._header[this._headerOffset++] = chunk[offset++];
      }

      if (this._headerOffset < HEADER_LENGTH) {
        return;
      }

      this._currentFragmentLength = readUInt24(this._header, 0);
      this._logicalPacketBytes += this._currentFragmentLength;
      this._headerOffset = 0;

      if (this._logicalPacketBytes > this._maxBytes) {
        throw limitError(this._logicalPacketBytes, this._maxBytes);
      }

      this._payloadRemaining = this._currentFragmentLength;

      if (this._payloadRemaining === 0) {
        this._finishFragment();
        continue;
      }
    }

    var available = chunk.length - offset;
    var consumed = Math.min(available, this._payloadRemaining);
    offset += consumed;
    this._payloadRemaining -= consumed;

    if (this._payloadRemaining === 0) {
      this._finishFragment();
    }
  }
};

InboundPacketLimiter.prototype.reset = function reset() {
  this._headerOffset = 0;
  this._payloadRemaining = 0;
  this._currentFragmentLength = 0;
  this._logicalPacketBytes = 0;
};

InboundPacketLimiter.prototype._finishFragment = function _finishFragment() {
  if (this._currentFragmentLength < MAX_FRAGMENT_LENGTH) {
    this._logicalPacketBytes = 0;
  }

  this._currentFragmentLength = 0;
};

function readUInt24(buffer, offset) {
  return buffer[offset] |
    (buffer[offset + 1] << 8) |
    (buffer[offset + 2] << 16);
}

function limitError(packetLength, limit) {
  var error = new Error(
    'Inbound MySQL packet exceeds maxInboundPacketSize: ' + packetLength + ' > ' + limit
  );
  error.code = 'PROTOCOL_INBOUND_PACKET_TOO_LARGE';
  error.fatal = true;
  error.packetLength = packetLength;
  error.limit = limit;
  return error;
}
