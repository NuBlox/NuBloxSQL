'use strict';

function frame(type, payload) {
  var body = payload || Buffer.alloc(0);
  var result = Buffer.alloc(5 + body.length);
  result[0] = type.charCodeAt(0);
  result.writeUInt32BE(body.length + 4, 1);
  body.copy(result, 5);
  return result;
}

function cstring(value) {
  if (typeof value !== 'string') throw new TypeError('PostgreSQL string value must be a string');
  if (value.indexOf('\0') !== -1) throw new TypeError('PostgreSQL string value must not contain NUL');
  return Buffer.from(value + '\0', 'utf8');
}

function encodePasswordMessage(password) {
  return frame('p', cstring(String(password)));
}

function encodeSaslInitialResponse(mechanism, response) {
  var mechanismBuffer = cstring(mechanism);
  var responseBuffer = Buffer.from(response || '', 'utf8');
  var payload = Buffer.alloc(mechanismBuffer.length + 4 + responseBuffer.length);
  mechanismBuffer.copy(payload, 0);
  payload.writeInt32BE(responseBuffer.length, mechanismBuffer.length);
  responseBuffer.copy(payload, mechanismBuffer.length + 4);
  return frame('p', payload);
}

function encodeSaslResponse(response) {
  return frame('p', Buffer.from(response || '', 'utf8'));
}

function encodeQuery(sql) {
  if (typeof sql !== 'string') throw new TypeError('PostgreSQL query must be a string');
  if (sql.indexOf('\0') !== -1) throw new TypeError('PostgreSQL query must not contain NUL');
  return frame('Q', cstring(sql));
}

function encodeTerminate() {
  return frame('X', Buffer.alloc(0));
}

exports.frame = frame;
exports.encodePasswordMessage = encodePasswordMessage;
exports.encodeSaslInitialResponse = encodeSaslInitialResponse;
exports.encodeSaslResponse = encodeSaslResponse;
exports.encodeQuery = encodeQuery;
exports.encodeTerminate = encodeTerminate;
