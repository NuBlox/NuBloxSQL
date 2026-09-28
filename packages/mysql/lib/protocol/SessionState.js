'use strict';

var Buffer = require('safe-buffer').Buffer;

var TYPES = {
  0 : 'system_variables',
  1 : 'schema',
  2 : 'state_change',
  3 : 'gtids',
  4 : 'transaction_characteristics',
  5 : 'transaction_state'
};

exports.TYPES = TYPES;
exports.parse = parseSessionState;

function parseSessionState(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw protocolError('Session-state payload must be a Buffer');
  }

  var changes = [];
  var offset = 0;

  while (offset < buffer.length) {
    var type = buffer[offset++];
    var entity = readLengthCodedBuffer(buffer, offset);
    offset = entity.offset;

    changes.push(parseChange(type, entity.value));
  }

  return changes;
}

function parseChange(type, data) {
  var change = {
    type   : type,
    name   : TYPES[type] || 'unknown',
    values : [],
    data   : data
  };

  if (type === 0) {
    var variableName = readLengthCodedString(data, 0);
    var variableValue = readLengthCodedString(data, variableName.offset);
    assertFullyConsumed(data, variableValue.offset, type);
    change.values = [variableName.value, variableValue.value];
    change.variable = variableName.value;
    change.value = variableValue.value;
    return change;
  }

  if (type === 3) {
    if (data.length === 0) {
      throw protocolError('GTID session-state block is missing its encoding specification');
    }

    change.encoding = data[0];
    var gtid = readLengthCodedString(data, 1);
    assertFullyConsumed(data, gtid.offset, type);
    change.values = [gtid.value];
    change.value = gtid.value;
    return change;
  }

  if (type >= 1 && type <= 5) {
    var value = readLengthCodedString(data, 0);
    assertFullyConsumed(data, value.offset, type);
    change.values = [value.value];
    change.value = value.value;
    return change;
  }

  return change;
}

function readLengthCodedString(buffer, offset) {
  var value = readLengthCodedBuffer(buffer, offset);
  return {
    value  : value.value === null ? null : value.value.toString('utf8'),
    offset : value.offset
  };
}

function readLengthCodedBuffer(buffer, offset) {
  if (offset >= buffer.length) {
    throw protocolError('Truncated length-coded session-state value');
  }

  var first = buffer[offset++];
  var length;

  if (first <= 250) {
    length = first;
  } else if (first === 251) {
    return {value: null, offset: offset};
  } else if (first === 252) {
    requireBytes(buffer, offset, 2);
    length = buffer[offset] | (buffer[offset + 1] << 8);
    offset += 2;
  } else if (first === 253) {
    requireBytes(buffer, offset, 3);
    length = buffer[offset] |
      (buffer[offset + 1] << 8) |
      (buffer[offset + 2] << 16);
    offset += 3;
  } else if (first === 254) {
    requireBytes(buffer, offset, 8);
    var bigint = global.BigInt(0);

    for (var i = 0; i < 8; i++) {
      bigint |= global.BigInt(buffer[offset + i]) << global.BigInt(i * 8);
    }

    if (bigint > global.BigInt(Number.MAX_SAFE_INTEGER)) {
      throw protocolError('Session-state value length exceeds the JavaScript safe integer range');
    }

    length = Number(bigint);
    offset += 8;
  } else {
    throw protocolError('Invalid length-coded session-state prefix: ' + first);
  }

  requireBytes(buffer, offset, length);

  return {
    value  : buffer.slice(offset, offset + length),
    offset : offset + length
  };
}

function requireBytes(buffer, offset, length) {
  if (!Number.isSafeInteger(length) || length < 0 || offset + length > buffer.length) {
    throw protocolError('Truncated session-state payload');
  }
}

function assertFullyConsumed(buffer, offset, type) {
  if (offset !== buffer.length) {
    throw protocolError('Unexpected trailing bytes in session-state type ' + type);
  }
}

function protocolError(message) {
  var error = new Error(message);
  error.code = 'PARSER_SESSION_STATE_INVALID';
  error.fatal = true;
  return error;
}
