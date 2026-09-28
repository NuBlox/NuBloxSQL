'use strict';

var Buffer     = require('safe-buffer').Buffer;
var Crc32      = require('./Crc32');
var EventTypes = require('./EventTypes');

var BINLOG_CHECKSUM_ALG_OFF = 0;
var BINLOG_CHECKSUM_ALG_CRC32 = 1;
var BINLOG_CHECKSUM_ALG_UNDEF = 255;
var BINLOG_CHECKSUM_BYTES = 4;
var CHECKSUM_AWARE_VERSION = [5, 6, 1];
var EVENT_HEADER_LENGTH = 19;
var EVENT_FLAGS_OFFSET = 17;
var FORMAT_DESCRIPTION_SERVER_VERSION_LENGTH = 50;
var FORMAT_DESCRIPTION_COMMON_HEADER_LENGTH_OFFSET = 56;
var FORMAT_DESCRIPTION_SERVER_VERSION_OFFSET = 2;

module.exports = BinlogEventDecoder;

function BinlogEventDecoder(options) {
  options = options || {};

  var checksum = normalizeChecksumBytes(options.checksumBytes);

  this.checksumMode = checksum.mode;
  this.checksumBytes = checksum.bytes;
  this.checksumAlgorithm = checksum.mode === 'auto'
    ? 'unknown'
    : checksum.bytes === BINLOG_CHECKSUM_BYTES
      ? 'crc32'
      : 'manual';
  this.verifyChecksum = normalizeVerifyChecksum(options.verifyChecksum, checksum);
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

  var type = input[4];
  var checksumState = this._checksumStateForEvent(input, eventSize, type);

  if (checksumState.bytes > eventSize - EVENT_HEADER_LENGTH) {
    throw decodeError('Binlog checksum is larger than the event payload', 'BINLOG_EVENT_INVALID_CHECKSUM');
  }

  var payloadEnd = eventSize - checksumState.bytes;
  var payload = input.slice(EVENT_HEADER_LENGTH, payloadEnd);
  var checksum = checksumState.bytes
    ? input.slice(payloadEnd, eventSize)
    : null;
  var event = {
    timestamp         : input.readUInt32LE(0),
    type              : type,
    typeName          : EventTypes[type] || 'UNKNOWN_EVENT_' + type,
    serverId          : input.readUInt32LE(5),
    eventSize         : eventSize,
    logPosition       : input.readUInt32LE(13),
    flags             : input.readUInt16LE(EVENT_FLAGS_OFFSET),
    payload           : payload,
    checksum          : checksum,
    checksumAlgorithm : checksumState.algorithm,
    checksumVerified  : false
  };

  if (checksumState.verify) {
    verifyCrc32(input, eventSize, type, event);
  }

  switch (type) {
    case EventTypes.ROTATE_EVENT:
      decodeRotateEvent(event, payload);
      break;
    case EventTypes.QUERY_EVENT:
      decodeQueryEvent(event, payload);
      break;
    case EventTypes.FORMAT_DESCRIPTION_EVENT:
      decodeFormatDescriptionEvent(event, payload, checksumState.descriptorPresent);
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

BinlogEventDecoder.prototype._checksumStateForEvent = function _checksumStateForEvent(input, eventSize, type) {
  if (type === EventTypes.FORMAT_DESCRIPTION_EVENT && this.checksumMode === 'auto') {
    return this._learnChecksumFromFormatDescription(input, eventSize);
  }

  var descriptorPresent = type === EventTypes.FORMAT_DESCRIPTION_EVENT &&
    this.checksumBytes === BINLOG_CHECKSUM_BYTES &&
    isChecksumAwareFormatDescription(input, eventSize);

  return {
    bytes             : this.checksumBytes,
    algorithm         : this.checksumAlgorithm,
    descriptorPresent : descriptorPresent,
    verify            : this.verifyChecksum && this.checksumBytes === BINLOG_CHECKSUM_BYTES
  };
};

BinlogEventDecoder.prototype._learnChecksumFromFormatDescription = function _learnChecksumFromFormatDescription(input, eventSize) {
  var algorithm = detectFormatDescriptionChecksum(input, eventSize);

  if (algorithm === BINLOG_CHECKSUM_ALG_UNDEF) {
    this.checksumAlgorithm = 'undefined';
    this.checksumBytes = 0;

    return {
      bytes             : 0,
      algorithm         : 'undefined',
      descriptorPresent : false,
      verify            : false
    };
  }

  if (algorithm !== BINLOG_CHECKSUM_ALG_OFF && algorithm !== BINLOG_CHECKSUM_ALG_CRC32) {
    var unsupported = decodeError(
      'Unsupported binlog checksum algorithm: ' + algorithm,
      'BINLOG_CHECKSUM_UNSUPPORTED_ALGORITHM'
    );
    unsupported.algorithm = algorithm;
    throw unsupported;
  }

  this.checksumAlgorithm = algorithm === BINLOG_CHECKSUM_ALG_CRC32
    ? 'crc32'
    : 'off';
  this.checksumBytes = algorithm === BINLOG_CHECKSUM_ALG_CRC32
    ? BINLOG_CHECKSUM_BYTES
    : 0;

  // Checksum-aware FDEs themselves always carry the four-byte CRC footer.
  // The descriptor controls checksums for the events that follow.
  return {
    bytes             : BINLOG_CHECKSUM_BYTES,
    algorithm         : this.checksumAlgorithm,
    descriptorPresent : true,
    verify            : this.verifyChecksum
  };
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

function decodeFormatDescriptionEvent(event, payload, descriptorPresent) {
  var minimumLength = 2 + FORMAT_DESCRIPTION_SERVER_VERSION_LENGTH + 4 + 1;
  requirePayload(payload, minimumLength, 'FORMAT_DESCRIPTION_EVENT');

  var serverVersionBuffer = payload.slice(2, 2 + FORMAT_DESCRIPTION_SERVER_VERSION_LENGTH);
  var terminator = serverVersionBuffer.indexOf(0x00);
  var versionEnd = terminator === -1
    ? serverVersionBuffer.length
    : terminator;
  var eventHeaderLengthsEnd = payload.length;

  if (descriptorPresent) {
    requirePayload(payload, minimumLength + 1, 'FORMAT_DESCRIPTION_EVENT checksum descriptor');
    event.checksumAlgorithmCode = payload[payload.length - 1];
    eventHeaderLengthsEnd--;
  }

  event.binlogVersion = payload.readUInt16LE(0);
  event.serverVersion = serverVersionBuffer.toString('utf8', 0, versionEnd);
  event.createTimestamp = payload.readUInt32LE(52);
  event.commonHeaderLength = payload[56];
  event.eventHeaderLengths = payload.slice(57, eventHeaderLengthsEnd);
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

function detectFormatDescriptionChecksum(input, eventSize) {
  if (!isChecksumAwareFormatDescription(input, eventSize)) {
    return BINLOG_CHECKSUM_ALG_UNDEF;
  }

  if (eventSize < EVENT_HEADER_LENGTH + BINLOG_CHECKSUM_BYTES + 1) {
    throw decodeError('FORMAT_DESCRIPTION_EVENT checksum footer is truncated', 'BINLOG_EVENT_TRUNCATED');
  }

  return input[eventSize - BINLOG_CHECKSUM_BYTES - 1];
}

function isChecksumAwareFormatDescription(input, eventSize) {
  var commonHeaderLengthOffset = EVENT_HEADER_LENGTH + FORMAT_DESCRIPTION_COMMON_HEADER_LENGTH_OFFSET;

  if (eventSize <= commonHeaderLengthOffset) {
    return false;
  }

  var commonHeaderLength = input[commonHeaderLengthOffset];
  var versionOffset = commonHeaderLength + FORMAT_DESCRIPTION_SERVER_VERSION_OFFSET;
  var versionEnd = versionOffset + FORMAT_DESCRIPTION_SERVER_VERSION_LENGTH;

  if (versionEnd > eventSize) {
    return false;
  }

  var version = input.toString('ascii', versionOffset, versionEnd);
  return compareVersion(splitServerVersion(version), CHECKSUM_AWARE_VERSION) >= 0;
}

function splitServerVersion(version) {
  var parts = [0, 0, 0];
  var offset = 0;

  for (var index = 0; index < parts.length; index++) {
    var value = 0;
    var digits = 0;

    while (offset < version.length) {
      var code = version.charCodeAt(offset);

      if (code < 48 || code > 57) {
        break;
      }

      value = value * 10 + code - 48;
      digits++;
      offset++;
    }

    if (!digits || value > 255) {
      return [0, 0, 0];
    }

    parts[index] = value;

    if (index < parts.length - 1) {
      if (version[offset] !== '.') {
        return [0, 0, 0];
      }
      offset++;
    }
  }

  return parts;
}

function compareVersion(left, right) {
  for (var index = 0; index < 3; index++) {
    if (left[index] !== right[index]) {
      return left[index] < right[index] ? -1 : 1;
    }
  }

  return 0;
}

function verifyCrc32(input, eventSize, type, event) {
  if (eventSize < BINLOG_CHECKSUM_BYTES) {
    throw decodeError('Binlog CRC32 footer is truncated', 'BINLOG_EVENT_TRUNCATED');
  }

  var checksumOffset = eventSize - BINLOG_CHECKSUM_BYTES;
  var incoming = input.readUInt32LE(checksumOffset);
  var computed = Crc32.compute(
    input,
    checksumOffset,
    type === EventTypes.FORMAT_DESCRIPTION_EVENT
  );

  event.checksumValue = incoming;
  event.computedChecksum = computed;

  if (incoming !== computed) {
    var mismatch = decodeError(
      'Binlog CRC32 mismatch: ' + incoming + ' !== ' + computed,
      'BINLOG_CHECKSUM_MISMATCH'
    );
    mismatch.incoming = incoming;
    mismatch.computed = computed;
    throw mismatch;
  }

  event.checksumVerified = true;
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

    if (value > global.BigInt(Number.MAX_SAFE_INTEGER)) {
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

  var value = global.BigInt(0);
  for (var index = 0; index < 8; index++) {
    value |= global.BigInt(buffer[offset + index]) << global.BigInt(index * 8);
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
  if (value === 'auto') {
    return {mode: 'auto', bytes: 0};
  }

  if (value === undefined) {
    return {mode: 'manual', bytes: 0};
  }

  if (!Number.isSafeInteger(value) || value < 0 || value > 64) {
    throw new TypeError("checksumBytes must be 'auto' or an integer from 0 to 64");
  }

  return {mode: 'manual', bytes: value};
}

function normalizeVerifyChecksum(value, checksum) {
  if (value === undefined) {
    return checksum.mode === 'auto';
  }

  if (typeof value !== 'boolean') {
    throw new TypeError('verifyChecksum must be a boolean');
  }

  if (value && checksum.mode === 'manual' && checksum.bytes !== BINLOG_CHECKSUM_BYTES) {
    throw new TypeError('verifyChecksum requires checksumBytes: 4 or checksumBytes: \'auto\'');
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
