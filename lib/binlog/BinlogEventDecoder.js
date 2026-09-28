'use strict';

var Buffer     = require('safe-buffer').Buffer;
var EventTypes = require('./EventTypes');

var EVENT_HEADER_LENGTH = 19;
var FORMAT_DESCRIPTION_SERVER_VERSION_LENGTH = 50;

module.exports = BinlogEventDecoder;

function BinlogEventDecoder(options) {
  options = options || {};

  this.checksumBytes = normalizeChecksumBytes(options.checksumBytes);
  this.maxEventSize = normalizeMaxEventSize(options.maxEventSize);
}

BinlogEventDecoder.prototype.decode = function decode(input) {
  if (!Buffer.isBuffer(input)) {
    throw new TypeError('binlog event must be a Buffer');
  }

  if (input.length < EVENT_HEADER_LENGTH) {
    throw decodeError('Binlog event is shorter than the 19-byte event header', 'BINLOG_EVENT_TRUNCATED');
  }

  var eventSize = input.readUInt32LE(9);

  if (eventSize < EVENT_HEADER_LENGTH) {
    throw decodeError('Binlog event declares an invalid event size: ' + eventSize, 'BINLOG_EVENT_INVALID_SIZE');
  }

  if (eventSize > this.maxEventSize) {
    var limitError = decodeError(
      'Binlog event exceeds maxEventSize: ' + eventSize + ' > ' + this.maxEventSize,
      'BINLOG_EVENT_TOO_LARGE'
    );
    limitError.eventSize = eventSize;
    limitError.limit = this.maxEventSize;
    throw limitError;
  }

  if (eventSize > input.length) {
    var truncatedError = decodeError(
      'Binlog event payload is truncated: ' + input.length + ' < ' + eventSize,
      'BINLOG_EVENT_TRUNCATED'
    );
    truncatedError.eventSize = eventSize;
    truncatedError.availableBytes = input.length;
    throw truncatedError;
  }

  if (this.checksumBytes > eventSize - EVENT_HEADER_LENGTH) {
    throw decodeError('Binlog checksum is larger than the event payload', 'BINLOG_EVENT_INVALID_CHECKSUM');
  }

  var type = input[4];
  var payloadEnd = eventSize - this.checksumBytes;
  var payload = input.slice(EVENT_HEADER_LENGTH, payloadEnd);
  var checksum = this.checksumBytes
    ? input.slice(payloadEnd, eventSize)
    : null;
  var event = {
    timestamp   : input.readUInt32LE(0),
    type        : type,
    typeName    : EventTypes[type] || 'UNKNOWN_EVENT_' + type,
    serverId    : input.readUInt32LE(5),
    eventSize   : eventSize,
    logPosition : input.readUInt32LE(13),
    flags       : input.readUInt16LE(17),
    payload     : payload,
    checksum    : checksum
  };

  switch (type) {
    case EventTypes.ROTATE_EVENT:
      decodeRotateEvent(event, payload);
      break;
    case EventTypes.QUERY_EVENT:
      decodeQueryEvent(event, payload);
      break;
    case EventTypes.FORMAT_DESCRIPTION_EVENT:
      decodeFormatDescriptionEvent(event, payload);
      break;
    case EventTypes.XID_EVENT:
      decodeXidEvent(event, payload);
      break;
    case EventTypes.TABLE_MAP_EVENT:
      decodeTableMapEvent(event, payload);
      break;
  }

  return event;
};

function decodeRotateEvent(event, payload) {
  requirePayload(payload, 8, 'ROTATE_EVENT');

  event.position = readUInt64LE(payload, 0);
  event.nextBinlog = payload.toString('utf8', 8);
}

function decodeQueryEvent(event, payload) {
  requirePayload(payload, 13, 'QUERY_EVENT');

  var schemaLength = payload[8];
  var statusVariablesLength = payload.readUInt16LE(11);
  var schemaOffset = 13 + statusVariablesLength;
  var schemaEnd = schemaOffset + schemaLength;
  var queryOffset = schemaEnd + 1;

  if (queryOffset > payload.length || payload[schemaEnd] !== 0x00) {
    throw decodeError('QUERY_EVENT contains truncated status/schema data', 'BINLOG_EVENT_TRUNCATED');
  }

  event.threadId = payload.readUInt32LE(0);
  event.executionTime = payload.readUInt32LE(4);
  event.errorCode = payload.readUInt16LE(9);
  event.statusVariables = payload.slice(13, schemaOffset);
  event.schema = payload.toString('utf8', schemaOffset, schemaEnd);
  event.query = payload.toString('utf8', queryOffset);
}

function decodeFormatDescriptionEvent(event, payload) {
  var minimumLength = 2 + FORMAT_DESCRIPTION_SERVER_VERSION_LENGTH + 4 + 1;
  requirePayload(payload, minimumLength, 'FORMAT_DESCRIPTION_EVENT');

  var serverVersionBuffer = payload.slice(2, 2 + FORMAT_DESCRIPTION_SERVER_VERSION_LENGTH);
  var terminator = serverVersionBuffer.indexOf(0x00);
  var versionEnd = terminator === -1
    ? serverVersionBuffer.length
    : terminator;

  event.binlogVersion = payload.readUInt16LE(0);
  event.serverVersion = serverVersionBuffer.toString('utf8', 0, versionEnd);
  event.createTimestamp = payload.readUInt32LE(52);
  event.commonHeaderLength = payload[56];
  event.eventHeaderLengths = payload.slice(57);
}

function decodeXidEvent(event, payload) {
  requirePayload(payload, 8, 'XID_EVENT');
  event.xid = readUInt64LE(payload, 0);
}

function decodeTableMapEvent(event, payload) {
  requirePayload(payload, 8, 'TABLE_MAP_EVENT');

  var offset = 0;
  event.tableId = readUInt48LE(payload, offset);
  offset += 6;
  event.tableFlags = payload.readUInt16LE(offset);
  offset += 2;

  requireOffset(payload, offset + 1, 'TABLE_MAP_EVENT database length');
  var databaseLength = payload[offset++];
  requireOffset(payload, offset + databaseLength + 1, 'TABLE_MAP_EVENT database');
  event.database = payload.toString('utf8', offset, offset + databaseLength);
  offset += databaseLength;
  requireNull(payload, offset, 'TABLE_MAP_EVENT database');
  offset++;

  requireOffset(payload, offset + 1, 'TABLE_MAP_EVENT table length');
  var tableLength = payload[offset++];
  requireOffset(payload, offset + tableLength + 1, 'TABLE_MAP_EVENT table');
  event.table = payload.toString('utf8', offset, offset + tableLength);
  offset += tableLength;
  requireNull(payload, offset, 'TABLE_MAP_EVENT table');
  offset++;

  var columnCountValue = readLengthCodedInteger(payload, offset);
  event.columnCount = columnCountValue.value;
  offset = columnCountValue.offset;

  if (event.columnCount > payload.length - offset) {
    throw decodeError('TABLE_MAP_EVENT column type list is truncated', 'BINLOG_EVENT_TRUNCATED');
  }

  event.columnTypes = payload.slice(offset, offset + event.columnCount);
  offset += event.columnCount;

  var metadataLengthValue = readLengthCodedInteger(payload, offset);
  var metadataLength = metadataLengthValue.value;
  offset = metadataLengthValue.offset;
  requireOffset(payload, offset + metadataLength, 'TABLE_MAP_EVENT column metadata');
  event.columnMetadata = payload.slice(offset, offset + metadataLength);
  offset += metadataLength;

  var nullBitmapLength = Math.floor((event.columnCount + 7) / 8);
  requireOffset(payload, offset + nullBitmapLength, 'TABLE_MAP_EVENT null bitmap');
  event.nullBitmap = payload.slice(offset, offset + nullBitmapLength);
  offset += nullBitmapLength;
  event.extraData = payload.slice(offset);
}

function readLengthCodedInteger(buffer, offset) {
  requireOffset(buffer, offset + 1, 'length-coded integer');
  var first = buffer[offset++];

  if (first < 0xfb) {
    return {value: first, offset: offset};
  }

  if (first === 0xfc) {
    requireOffset(buffer, offset + 2, 'length-coded integer');
    return {value: buffer.readUInt16LE(offset), offset: offset + 2};
  }

  if (first === 0xfd) {
    requireOffset(buffer, offset + 3, 'length-coded integer');
    return {
      value  : buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16),
      offset : offset + 3
    };
  }

  if (first === 0xfe) {
    requireOffset(buffer, offset + 8, 'length-coded integer');
    var value = readUInt64LE(buffer, offset);

    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw decodeError('Length-coded integer exceeds JavaScript safe integer range', 'BINLOG_INTEGER_TOO_LARGE');
    }

    return {value: Number(value), offset: offset + 8};
  }

  throw decodeError('Invalid length-coded integer marker: ' + first, 'BINLOG_INVALID_LENGTH_CODED_INTEGER');
}

function readUInt48LE(buffer, offset) {
  requireOffset(buffer, offset + 6, '48-bit integer');

  return buffer[offset] +
    buffer[offset + 1] * 0x100 +
    buffer[offset + 2] * 0x10000 +
    buffer[offset + 3] * 0x1000000 +
    buffer[offset + 4] * 0x100000000 +
    buffer[offset + 5] * 0x10000000000;
}

function readUInt64LE(buffer, offset) {
  requireOffset(buffer, offset + 8, '64-bit integer');

  var value = BigInt(0);
  for (var index = 0; index < 8; index++) {
    value |= BigInt(buffer[offset + index]) << BigInt(index * 8);
  }

  return value;
}

function requirePayload(payload, bytes, eventName) {
  if (payload.length < bytes) {
    throw decodeError(eventName + ' payload is truncated', 'BINLOG_EVENT_TRUNCATED');
  }
}

function requireOffset(buffer, end, label) {
  if (end > buffer.length) {
    throw decodeError(label + ' is truncated', 'BINLOG_EVENT_TRUNCATED');
  }
}

function requireNull(buffer, offset, label) {
  requireOffset(buffer, offset + 1, label);
  if (buffer[offset] !== 0x00) {
    throw decodeError(label + ' is not null terminated', 'BINLOG_EVENT_INVALID');
  }
}

function normalizeChecksumBytes(value) {
  if (value === undefined) {
    return 0;
  }

  if (!Number.isSafeInteger(value) || value < 0 || value > 64) {
    throw new TypeError('checksumBytes must be an integer from 0 to 64');
  }

  return value;
}

function normalizeMaxEventSize(value) {
  if (value === undefined) {
    return 64 * 1024 * 1024;
  }

  if (!Number.isSafeInteger(value) || value < EVENT_HEADER_LENGTH) {
    throw new TypeError('maxEventSize must be a safe integer of at least 19 bytes');
  }

  return value;
}

function decodeError(message, code) {
  var error = new Error(message);
  error.code = code;
  return error;
}
