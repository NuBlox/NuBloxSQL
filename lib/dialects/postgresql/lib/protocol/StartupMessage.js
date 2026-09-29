'use strict';

var constants = require('./constants');

function writeCString(value) {
  if (typeof value !== 'string') {
    throw new TypeError('PostgreSQL startup parameter values must be strings');
  }
  if (value.indexOf('\0') !== -1) {
    throw new TypeError('PostgreSQL startup parameters cannot contain NUL bytes');
  }
  return Buffer.from(value + '\0', 'utf8');
}

function encodeStartupMessage(parameters, protocolVersion) {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    throw new TypeError('PostgreSQL startup parameters must be an object');
  }
  if (typeof parameters.user !== 'string' || parameters.user.length === 0) {
    throw new TypeError('PostgreSQL startup parameters require a non-empty user');
  }

  var version = protocolVersion === undefined ? constants.PROTOCOL_VERSION_3_0 : protocolVersion;
  if (!Number.isInteger(version) || version < 0 || version > 0xffffffff) {
    throw new RangeError('PostgreSQL protocol version must be an unsigned 32-bit integer');
  }

  var chunks = [];
  Object.keys(parameters).forEach(function addParameter(key) {
    if (parameters[key] === undefined || parameters[key] === null) return;
    chunks.push(writeCString(key));
    chunks.push(writeCString(String(parameters[key])));
  });
  chunks.push(Buffer.from([0]));

  var bodyLength = 4 + chunks.reduce(function sum(total, chunk) { return total + chunk.length; }, 0);
  var message = Buffer.allocUnsafe(4 + bodyLength);
  message.writeUInt32BE(message.length, 0);
  message.writeUInt32BE(version >>> 0, 4);

  var offset = 8;
  chunks.forEach(function copy(chunk) {
    chunk.copy(message, offset);
    offset += chunk.length;
  });

  return message;
}

function encodeSSLRequest() {
  var message = Buffer.allocUnsafe(8);
  message.writeUInt32BE(8, 0);
  message.writeUInt32BE(constants.SSL_REQUEST_CODE, 4);
  return message;
}

function encodeCancelRequest(processId, secretKey) {
  if (!Number.isInteger(processId) || processId < 0 || processId > 0xffffffff) {
    throw new RangeError('PostgreSQL CancelRequest processId must be an unsigned 32-bit integer');
  }
  if (!Buffer.isBuffer(secretKey) && !(secretKey instanceof Uint8Array)) {
    throw new TypeError('PostgreSQL CancelRequest secretKey must be Buffer or Uint8Array');
  }
  var key = Buffer.isBuffer(secretKey) ? secretKey : Buffer.from(secretKey.buffer, secretKey.byteOffset, secretKey.byteLength);
  if (key.length < 4 || key.length > 256) {
    throw new RangeError('PostgreSQL CancelRequest secretKey must contain 4 to 256 bytes');
  }
  var message = Buffer.allocUnsafe(12 + key.length);
  message.writeUInt32BE(message.length, 0);
  message.writeUInt32BE(constants.CANCEL_REQUEST_CODE, 4);
  message.writeUInt32BE(processId >>> 0, 8);
  key.copy(message, 12);
  return message;
}

exports.encodeStartupMessage = encodeStartupMessage;
exports.encodeSSLRequest = encodeSSLRequest;
exports.encodeCancelRequest = encodeCancelRequest;
