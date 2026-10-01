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

function uint16Count(value, name) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new RangeError(name + ' count must be an integer between 0 and 65535');
  return value;
}

function uint32(value, name) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new RangeError(name + ' must be an unsigned 32-bit integer');
  return value;
}

function formatCodes(values, name) {
  values = values || [];
  if (!Array.isArray(values)) throw new TypeError(name + ' must be an array');
  uint16Count(values.length, name);
  var buffer = Buffer.alloc(2 + values.length * 2);
  buffer.writeUInt16BE(values.length, 0);
  for (var i = 0; i < values.length; i++) {
    if (values[i] !== 0 && values[i] !== 1) throw new RangeError(name + ' entries must be 0 (text) or 1 (binary)');
    buffer.writeUInt16BE(values[i], 2 + i * 2);
  }
  return buffer;
}

function parameterValue(value) {
  if (value === null || value === undefined) {
    var nullValue = Buffer.alloc(4);
    nullValue.writeInt32BE(-1, 0);
    return nullValue;
  }
  var bytes;
  if (Buffer.isBuffer(value)) bytes = value;
  else if (value instanceof Uint8Array) bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  else if (typeof value === 'string') bytes = Buffer.from(value, 'utf8');
  else throw new TypeError('PostgreSQL Bind parameter values must be strings, Buffer/Uint8Array, null, or undefined');
  if (bytes.length > 0x7fffffff) throw new RangeError('PostgreSQL Bind parameter exceeds Int32 length');
  var result = Buffer.alloc(4 + bytes.length);
  result.writeInt32BE(bytes.length, 0);
  bytes.copy(result, 4);
  return result;
}

function targetMessage(type, target, name, label) {
  if (target !== 'S' && target !== 'P') throw new TypeError("PostgreSQL " + label + " target must be 'S' (statement) or 'P' (portal)");
  return frame(type, Buffer.concat([Buffer.from(target, 'ascii'), cstring(name || '')]));
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

function encodeParse(statement, sql, parameterTypeOids) {
  if (typeof sql !== 'string') throw new TypeError('PostgreSQL Parse query must be a string');
  var statementBuffer = cstring(statement || '');
  var queryBuffer = cstring(sql);
  var oids = parameterTypeOids || [];
  if (!Array.isArray(oids)) throw new TypeError('PostgreSQL Parse parameterTypeOids must be an array');
  uint16Count(oids.length, 'PostgreSQL Parse parameterTypeOids');
  var types = Buffer.alloc(2 + oids.length * 4);
  types.writeUInt16BE(oids.length, 0);
  for (var i = 0; i < oids.length; i++) types.writeUInt32BE(uint32(oids[i], 'PostgreSQL Parse parameter type OID'), 2 + i * 4);
  return frame('P', Buffer.concat([statementBuffer, queryBuffer, types]));
}

function encodeBind(options) {
  options = options || {};
  var portal = cstring(options.portal || '');
  var statement = cstring(options.statement || '');
  var parameterFormats = formatCodes(options.parameterFormats, 'PostgreSQL Bind parameterFormats');
  var values = options.parameters || [];
  if (!Array.isArray(values)) throw new TypeError('PostgreSQL Bind parameters must be an array');
  uint16Count(values.length, 'PostgreSQL Bind parameters');
  var count = Buffer.alloc(2);
  count.writeUInt16BE(values.length, 0);
  var valueBuffers = values.map(parameterValue);
  var resultFormats = formatCodes(options.resultFormats, 'PostgreSQL Bind resultFormats');
  return frame('B', Buffer.concat([portal, statement, parameterFormats, count].concat(valueBuffers, [resultFormats])));
}

function encodeDescribe(target, name) {
  return targetMessage('D', target, name, 'Describe');
}

function encodeExecute(portal, maxRows) {
  if (maxRows === undefined) maxRows = 0;
  uint32(maxRows, 'PostgreSQL Execute maxRows');
  var rows = Buffer.alloc(4);
  rows.writeUInt32BE(maxRows, 0);
  return frame('E', Buffer.concat([cstring(portal || ''), rows]));
}

function encodeClose(target, name) {
  return targetMessage('C', target, name, 'Close');
}

function encodeSync() {
  return frame('S', Buffer.alloc(0));
}

function encodeCopyData(data) {
  var bytes;
  if (Buffer.isBuffer(data)) bytes = data;
  else if (data instanceof Uint8Array) bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  else if (typeof data === 'string') bytes = Buffer.from(data, 'utf8');
  else throw new TypeError('PostgreSQL CopyData requires string, Buffer, or Uint8Array');
  return frame('d', bytes);
}

function encodeCopyDone() {
  return frame('c', Buffer.alloc(0));
}

function encodeCopyFail(message) {
  if (message === undefined || message === null) message = 'NuBloxSQL COPY input failed';
  return frame('f', cstring(String(message)));
}

function encodeTerminate() {
  return frame('X', Buffer.alloc(0));
}

exports.frame = frame;
exports.encodePasswordMessage = encodePasswordMessage;
exports.encodeSaslInitialResponse = encodeSaslInitialResponse;
exports.encodeSaslResponse = encodeSaslResponse;
exports.encodeQuery = encodeQuery;
exports.encodeParse = encodeParse;
exports.encodeBind = encodeBind;
exports.encodeDescribe = encodeDescribe;
exports.encodeExecute = encodeExecute;
exports.encodeClose = encodeClose;
exports.encodeSync = encodeSync;
exports.encodeCopyData = encodeCopyData;
exports.encodeCopyDone = encodeCopyDone;
exports.encodeCopyFail = encodeCopyFail;
exports.encodeTerminate = encodeTerminate;
