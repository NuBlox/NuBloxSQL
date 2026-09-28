'use strict';

var constants = require('./constants');

function readCString(buffer, offset) {
  var end = buffer.indexOf(0, offset);
  if (end === -1) throw new Error('Malformed PostgreSQL message: unterminated string');
  return { value: buffer.toString('utf8', offset, end), nextOffset: end + 1 };
}

function emptyMessage(payload, type, label) {
  if (payload.length !== 0) throw new Error('Malformed PostgreSQL ' + label + ' message');
  return { type: type };
}

function decodeAuthentication(payload) {
  if (payload.length < 4) throw new Error('Malformed PostgreSQL Authentication message');
  var code = payload.readUInt32BE(0);
  var message = { type: 'authentication', code: code };
  if (code === constants.AUTHENTICATION.MD5_PASSWORD) {
    if (payload.length !== 8) throw new Error('Malformed PostgreSQL AuthenticationMD5Password message');
    message.salt = Buffer.from(payload.subarray(4, 8));
  } else if (code === constants.AUTHENTICATION.SASL) {
    var mechanisms = [];
    var offset = 4;
    while (offset < payload.length) {
      if (payload[offset] === 0) { offset += 1; break; }
      var item = readCString(payload, offset);
      mechanisms.push(item.value);
      offset = item.nextOffset;
    }
    if (offset !== payload.length) throw new Error('Malformed PostgreSQL AuthenticationSASL message');
    message.mechanisms = mechanisms;
  } else if (code === constants.AUTHENTICATION.SASL_CONTINUE || code === constants.AUTHENTICATION.SASL_FINAL || code === constants.AUTHENTICATION.GSS_CONTINUE) {
    message.data = Buffer.from(payload.subarray(4));
  } else if (payload.length !== 4) {
    message.data = Buffer.from(payload.subarray(4));
  }
  return message;
}

function decodeParameterStatus(payload) {
  var name = readCString(payload, 0);
  var value = readCString(payload, name.nextOffset);
  if (value.nextOffset !== payload.length) throw new Error('Malformed PostgreSQL ParameterStatus message');
  return { type: 'parameterStatus', name: name.value, value: value.value };
}

function decodeBackendKeyData(payload) {
  if (payload.length < 8) throw new Error('Malformed PostgreSQL BackendKeyData message');
  var secretKey = Buffer.from(payload.subarray(4));
  if (secretKey.length < 4 || secretKey.length > 256) throw new Error('Malformed PostgreSQL BackendKeyData secret key length');
  return { type: 'backendKeyData', processId: payload.readUInt32BE(0), secretKey: secretKey };
}

function decodeReadyForQuery(payload) {
  if (payload.length !== 1) throw new Error('Malformed PostgreSQL ReadyForQuery message');
  var status = String.fromCharCode(payload[0]);
  if (status !== 'I' && status !== 'T' && status !== 'E') throw new Error('Malformed PostgreSQL ReadyForQuery transaction status');
  return { type: 'readyForQuery', transactionStatus: status };
}

function decodeFields(payload, type) {
  var fields = Object.create(null);
  var offset = 0;
  while (offset < payload.length) {
    var code = payload[offset++];
    if (code === 0) {
      if (offset !== payload.length) throw new Error('Malformed PostgreSQL Error/Notice response');
      return { type: type, fields: fields };
    }
    var value = readCString(payload, offset);
    fields[String.fromCharCode(code)] = value.value;
    offset = value.nextOffset;
  }
  throw new Error('Malformed PostgreSQL Error/Notice response: missing terminator');
}

function decodeRowDescription(payload) {
  if (payload.length < 2) throw new Error('Malformed PostgreSQL RowDescription message');
  var count = payload.readUInt16BE(0);
  var offset = 2;
  var fields = [];
  for (var i = 0; i < count; i++) {
    var name = readCString(payload, offset); offset = name.nextOffset;
    if (offset + 18 > payload.length) throw new Error('Malformed PostgreSQL RowDescription field');
    fields.push({
      name          : name.value,
      tableOid      : payload.readUInt32BE(offset),
      columnId      : payload.readInt16BE(offset + 4),
      dataTypeOid   : payload.readUInt32BE(offset + 6),
      dataTypeSize  : payload.readInt16BE(offset + 10),
      typeModifier  : payload.readInt32BE(offset + 12),
      format        : payload.readUInt16BE(offset + 16)
    });
    offset += 18;
  }
  if (offset !== payload.length) throw new Error('Malformed PostgreSQL RowDescription message');
  return { type: 'rowDescription', fields: fields };
}

function decodeDataRow(payload) {
  if (payload.length < 2) throw new Error('Malformed PostgreSQL DataRow message');
  var count = payload.readUInt16BE(0);
  var offset = 2;
  var values = [];
  for (var i = 0; i < count; i++) {
    if (offset + 4 > payload.length) throw new Error('Malformed PostgreSQL DataRow value length');
    var length = payload.readInt32BE(offset); offset += 4;
    if (length === -1) { values.push(null); continue; }
    if (length < 0 || offset + length > payload.length) throw new Error('Malformed PostgreSQL DataRow value');
    values.push(Buffer.from(payload.subarray(offset, offset + length)));
    offset += length;
  }
  if (offset !== payload.length) throw new Error('Malformed PostgreSQL DataRow message');
  return { type: 'dataRow', values: values };
}

function decodeCommandComplete(payload) {
  var tag = readCString(payload, 0);
  if (tag.nextOffset !== payload.length) throw new Error('Malformed PostgreSQL CommandComplete message');
  return { type: 'commandComplete', tag: tag.value };
}

function decodeParameterDescription(payload) {
  if (payload.length < 2) throw new Error('Malformed PostgreSQL ParameterDescription message');
  var count = payload.readUInt16BE(0);
  if (payload.length !== 2 + count * 4) throw new Error('Malformed PostgreSQL ParameterDescription message');
  var parameterTypeOids = [];
  for (var i = 0; i < count; i++) parameterTypeOids.push(payload.readUInt32BE(2 + i * 4));
  return { type: 'parameterDescription', parameterTypeOids: parameterTypeOids };
}

function decodeBackendMessage(messageType, payload) {
  switch (messageType) {
    case 'R': return decodeAuthentication(payload);
    case 'S': return decodeParameterStatus(payload);
    case 'K': return decodeBackendKeyData(payload);
    case 'Z': return decodeReadyForQuery(payload);
    case 'E': return decodeFields(payload, 'errorResponse');
    case 'N': return decodeFields(payload, 'noticeResponse');
    case 'T': return decodeRowDescription(payload);
    case 'D': return decodeDataRow(payload);
    case 'C': return decodeCommandComplete(payload);
    case 'I': return emptyMessage(payload, 'emptyQueryResponse', 'EmptyQueryResponse');
    case '1': return emptyMessage(payload, 'parseComplete', 'ParseComplete');
    case '2': return emptyMessage(payload, 'bindComplete', 'BindComplete');
    case '3': return emptyMessage(payload, 'closeComplete', 'CloseComplete');
    case 'n': return emptyMessage(payload, 'noData', 'NoData');
    case 's': return emptyMessage(payload, 'portalSuspended', 'PortalSuspended');
    case 't': return decodeParameterDescription(payload);
    default: return { type: 'unknown', messageType: messageType, payload: Buffer.from(payload) };
  }
}

exports.decodeBackendMessage = decodeBackendMessage;
