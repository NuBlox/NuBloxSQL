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

exports.encodeStartupMessage = encodeStartupMessage;
exports.encodeSSLRequest = encodeSSLRequest;
