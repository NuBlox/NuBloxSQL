'use strict';

var Buffer     = require('safe-buffer').Buffer;
var EventTypes = require('./EventTypes');

var MAX_COLUMNS = 4096;

exports.decode = function decodeRowEvent(event, payload, tableMap) {
  if (!event || !payload) {
    throw new TypeError('row event and payload are required');
  }

  requireOffset(payload, 8, event.typeName + ' post-header');

  var offset = 0;
  event.tableId = readUInt48LE(payload, offset);
  offset += 6;
  event.rowFlags = payload.readUInt16LE(offset);
  offset += 2;

  var isV2 = event.type === EventTypes.WRITE_ROWS_EVENT ||
    event.type === EventTypes.UPDATE_ROWS_EVENT ||
    event.type === EventTypes.DELETE_ROWS_EVENT;

  if (isV2) {
    requireOffset(payload, offset + 2, event.typeName + ' variable-header length');
    var variableHeaderLength = payload.readUInt16LE(offset);

    if (variableHeaderLength < 2) {
      throw decodeError('Row event variable-header length is smaller than 2', 'BINLOG_ROWS_INVALID_HEADER');
    }

    requireOffset(payload, offset + variableHeaderLength, event.typeName + ' variable header');
    event.extraData = payload.slice(offset + 2, offset + variableHeaderLength);
    offset += variableHeaderLength;
  } else {
    event.extraData = Buffer.alloc(0);
  }

  var columnCountValue = readLengthCodedInteger(payload, offset);
  event.rowColumnCount = columnCountValue.value;
  offset = columnCountValue.offset;

  if (event.rowColumnCount > MAX_COLUMNS) {
    var limitError = decodeError(
      'Row event column count exceeds supported maximum: ' + event.rowColumnCount + ' > ' + MAX_COLUMNS,
      'BINLOG_ROWS_TOO_MANY_COLUMNS'
    );
    limitError.columnCount = event.rowColumnCount;
    limitError.limit = MAX_COLUMNS;
    throw limitError;
  }

  var bitmapLength = Math.floor((event.rowColumnCount + 7) / 8);
  requireOffset(payload, offset + bitmapLength, event.typeName + ' column bitmap');
  event.columnsPresent = payload.slice(offset, offset + bitmapLength);
  offset += bitmapLength;

  if (isUpdate(event.type)) {
    requireOffset(payload, offset + bitmapLength, event.typeName + ' after-image bitmap');
    event.columnsPresentBefore = event.columnsPresent;
    event.columnsPresentAfter = payload.slice(offset, offset + bitmapLength);
    offset += bitmapLength;
  } else if (isWrite(event.type)) {
    event.columnsPresentAfter = event.columnsPresent;
  } else {
    event.columnsPresentBefore = event.columnsPresent;
  }

  event.rowsPayload = payload.slice(offset);
  event.tableMapMatched = !!tableMap;

  if (!tableMap) {
    return;
  }

  if (tableMap.columnCount !== event.rowColumnCount) {
    var mismatch = decodeError(
      'Row event column count does not match TABLE_MAP_EVENT: ' +
        event.rowColumnCount + ' !== ' + tableMap.columnCount,
      'BINLOG_ROWS_TABLE_MAP_MISMATCH'
    );
    mismatch.tableId = event.tableId;
    mismatch.rowColumnCount = event.rowColumnCount;
    mismatch.tableMapColumnCount = tableMap.columnCount;
    throw mismatch;
  }

  event.database = tableMap.database;
  event.table = tableMap.table;
  event.tableMap = cloneTableMap(tableMap);
};

function cloneTableMap(tableMap) {
  return {
    tableId        : tableMap.tableId,
    database       : tableMap.database,
    table          : tableMap.table,
    columnCount    : tableMap.columnCount,
    columnTypes    : Buffer.from(tableMap.columnTypes),
    columnMetadata : Buffer.from(tableMap.columnMetadata),
    nullBitmap     : Buffer.from(tableMap.nullBitmap),
    extraData      : Buffer.from(tableMap.extraData)
  };
}

function isWrite(type) {
  return type === EventTypes.WRITE_ROWS_EVENT_V1 || type === EventTypes.WRITE_ROWS_EVENT;
}

function isUpdate(type) {
  return type === EventTypes.UPDATE_ROWS_EVENT_V1 || type === EventTypes.UPDATE_ROWS_EVENT;
}

function isDelete(type) {
  return type === EventTypes.DELETE_ROWS_EVENT_V1 || type === EventTypes.DELETE_ROWS_EVENT;
}

exports.isSupportedRowEvent = function isSupportedRowEvent(type) {
  return isWrite(type) || isUpdate(type) || isDelete(type);
};

function readLengthCodedInteger(buffer, offset) {
  requireOffset(buffer, offset + 1, 'row-event length-coded integer');
  var first = buffer[offset++];

  if (first < 0xfb) {
    return {value: first, offset: offset};
  }

  if (first === 0xfc) {
    requireOffset(buffer, offset + 2, 'row-event length-coded integer');
    return {value: buffer.readUInt16LE(offset), offset: offset + 2};
  }

  if (first === 0xfd) {
    requireOffset(buffer, offset + 3, 'row-event length-coded integer');
    return {
      value  : buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16),
      offset : offset + 3
    };
  }

  if (first === 0xfe) {
    requireOffset(buffer, offset + 8, 'row-event length-coded integer');
    var value = global.BigInt(0);

    for (var index = 0; index < 8; index++) {
      value |= global.BigInt(buffer[offset + index]) << global.BigInt(index * 8);
    }

    if (value > global.BigInt(Number.MAX_SAFE_INTEGER)) {
      throw decodeError('Row-event column count exceeds JavaScript safe integer range', 'BINLOG_INTEGER_TOO_LARGE');
    }

    return {value: Number(value), offset: offset + 8};
  }

  throw decodeError('Invalid row-event length-coded integer marker: ' + first, 'BINLOG_INVALID_LENGTH_CODED_INTEGER');
}

function readUInt48LE(buffer, offset) {
  requireOffset(buffer, offset + 6, 'row-event table id');

  return buffer[offset] +
    buffer[offset + 1] * 0x100 +
    buffer[offset + 2] * 0x10000 +
    buffer[offset + 3] * 0x1000000 +
    buffer[offset + 4] * 0x100000000 +
    buffer[offset + 5] * 0x10000000000;
}

function requireOffset(buffer, end, label) {
  if (end > buffer.length) {
    throw decodeError(label + ' is truncated', 'BINLOG_EVENT_TRUNCATED');
  }
}

function decodeError(message, code) {
  var error = new Error(message);
  error.code = code;
  return error;
}
