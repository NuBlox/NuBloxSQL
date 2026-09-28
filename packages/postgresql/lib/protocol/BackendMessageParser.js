'use strict';

var backendMessage = require('./BackendMessage');

function BackendMessageParser(options) {
  options = options || {};
  this.maxMessageSize = options.maxMessageSize === undefined ? 16 * 1024 * 1024 : options.maxMessageSize;
  if (!Number.isInteger(this.maxMessageSize) || this.maxMessageSize < 4) {
    throw new RangeError('PostgreSQL maxMessageSize must be an integer >= 4');
  }
  this.buffer = Buffer.alloc(0);
}

BackendMessageParser.prototype.push = function push(chunk) {
  if (!Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) {
    throw new TypeError('PostgreSQL protocol parser expects Buffer or Uint8Array input');
  }
  if (chunk.length === 0) return [];

  var incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  this.buffer = this.buffer.length === 0 ? Buffer.from(incoming) : Buffer.concat([this.buffer, incoming]);

  var messages = [];
  var offset = 0;
  while (this.buffer.length - offset >= 5) {
    var messageType = String.fromCharCode(this.buffer[offset]);
    var length = this.buffer.readUInt32BE(offset + 1);
    if (length < 4) throw new Error('Malformed PostgreSQL message length: ' + length);
    if (length > this.maxMessageSize) throw new Error('PostgreSQL message exceeds maxMessageSize');

    var frameLength = 1 + length;
    if (this.buffer.length - offset < frameLength) break;

    var payload = this.buffer.subarray(offset + 5, offset + frameLength);
    messages.push(backendMessage.decodeBackendMessage(messageType, payload));
    offset += frameLength;
  }

  if (offset > 0) this.buffer = Buffer.from(this.buffer.subarray(offset));
  return messages;
};

BackendMessageParser.prototype.reset = function reset() {
  this.buffer = Buffer.alloc(0);
};

module.exports = BackendMessageParser;
