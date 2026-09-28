'use strict';

var constants = require('./constants');

function readCString(buffer, offset) {
  var end = buffer.indexOf(0, offset);
  if (end === -1) {
    throw new Error('Malformed PostgreSQL message: unterminated string');
  }
  return { value: buffer.toString('utf8', offset, end), nextOffset: end + 1 };
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
      if (payload[offset] === 0) {
        offset += 1;
        break;
      }
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
  if (secretKey.length < 4 || secretKey.length > 256) {
    throw new Error('Malformed PostgreSQL BackendKeyData secret key length');
  }
  return { type: 'backendKeyData', processId: payload.readUInt32BE(0), secretKey: secretKey };
}

function decodeReadyForQuery(payload) {
  if (payload.length !== 1) throw new Error('Malformed PostgreSQL ReadyForQuery message');
  var status = String.fromCharCode(payload[0]);
  if (status !== 'I' && status !== 'T' && status !== 'E') {
    throw new Error('Malformed PostgreSQL ReadyForQuery transaction status');
  }
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

function decodeBackendMessage(messageType, payload) {
  switch (messageType) {
    case 'R': return decodeAuthentication(payload);
    case 'S': return decodeParameterStatus(payload);
    case 'K': return decodeBackendKeyData(payload);
    case 'Z': return decodeReadyForQuery(payload);
    case 'E': return decodeFields(payload, 'errorResponse');
    case 'N': return decodeFields(payload, 'noticeResponse');
    default: return { type: 'unknown', messageType: messageType, payload: Buffer.from(payload) };
  }
}

exports.decodeBackendMessage = decodeBackendMessage;
