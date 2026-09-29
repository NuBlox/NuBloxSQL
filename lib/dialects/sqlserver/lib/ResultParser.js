'use strict';

var TokenStream = require('./TokenStream');

var TOKENS = TokenStream.TOKENS;
var TYPES = Object.freeze({
  INT1: 0x30,
  BIT: 0x32,
  INT2: 0x34,
  INT4: 0x38,
  FLOAT4: 0x3b,
  FLOAT8: 0x3e,
  INT8: 0x7f,
  INTN: 0x26,
  BITN: 0x68,
  FLOATN: 0x6d,
  BIGVARBINARY: 0xa5,
  BIGVARCHAR: 0xa7,
  BIGBINARY: 0xad,
  BIGCHAR: 0xaf,
  NVARCHAR: 0xe7,
  NCHAR: 0xef
});

function need(buffer, offset, count, label) {
  if (offset + count > buffer.length) throw new RangeError('Incomplete SQL Server ' + label);
}

function readBVarChar(buffer, offset) {
  need(buffer, offset, 1, 'B_VARCHAR length');
  var chars = buffer[offset++];
  var bytes = chars * 2;
  need(buffer, offset, bytes, 'B_VARCHAR value');
  return { value: buffer.toString('utf16le', offset, offset + bytes), offset: offset + bytes };
}

function parseTypeInfo(buffer, offset) {
  need(buffer, offset, 1, 'TYPE_INFO');
  var type = buffer[offset++];
  var info = { type: type, maxLength: null, collation: null };
  if (type === TYPES.INT1 || type === TYPES.BIT || type === TYPES.INT2 || type === TYPES.INT4 || type === TYPES.INT8 || type === TYPES.FLOAT4 || type === TYPES.FLOAT8) {
    return { info: Object.freeze(info), offset: offset };
  }
  if (type === TYPES.INTN || type === TYPES.BITN || type === TYPES.FLOATN) {
    need(buffer, offset, 1, 'variable numeric TYPE_INFO length');
    info.maxLength = buffer[offset++];
    return { info: Object.freeze(info), offset: offset };
  }
  if (type === TYPES.BIGVARCHAR || type === TYPES.BIGCHAR || type === TYPES.NVARCHAR || type === TYPES.NCHAR) {
    need(buffer, offset, 7, 'character TYPE_INFO');
    info.maxLength = buffer.readUInt16LE(offset); offset += 2;
    info.collation = Buffer.from(buffer.subarray(offset, offset + 5)); offset += 5;
    return { info: Object.freeze(info), offset: offset };
  }
  if (type === TYPES.BIGVARBINARY || type === TYPES.BIGBINARY) {
    need(buffer, offset, 2, 'binary TYPE_INFO');
    info.maxLength = buffer.readUInt16LE(offset); offset += 2;
    return { info: Object.freeze(info), offset: offset };
  }
  throw new RangeError('Unsupported SQL Server result type 0x' + type.toString(16).padStart(2, '0'));
}

function parseColMetadata(buffer, offset) {
  need(buffer, offset, 3, 'COLMETADATA header');
  if (buffer[offset] !== TOKENS.COLMETADATA) throw new RangeError('Expected SQL Server COLMETADATA token');
  var start = offset++;
  var count = buffer.readUInt16LE(offset); offset += 2;
  if (count === 0xffff) return { columns: Object.freeze([]), bytesConsumed: offset - start, noMetadata: true };
  var columns = [];
  for (var index = 0; index < count; index++) {
    need(buffer, offset, 6, 'column metadata header');
    var userType = buffer.readUInt32LE(offset); offset += 4;
    var flags = buffer.readUInt16LE(offset); offset += 2;
    var parsedType = parseTypeInfo(buffer, offset); offset = parsedType.offset;
    var name = readBVarChar(buffer, offset); offset = name.offset;
    columns.push(Object.freeze({
      ordinal: index,
      name: name.value,
      userType: userType,
      flags: flags,
      nullable: (flags & 0x0001) !== 0,
      type: parsedType.info.type,
      maxLength: parsedType.info.maxLength,
      collation: parsedType.info.collation
    }));
  }
  return { columns: Object.freeze(columns), bytesConsumed: offset - start, noMetadata: false };
}

function fixedLength(type) {
  if (type === TYPES.INT1 || type === TYPES.BIT) return 1;
  if (type === TYPES.INT2) return 2;
  if (type === TYPES.INT4 || type === TYPES.FLOAT4) return 4;
  if (type === TYPES.INT8 || type === TYPES.FLOAT8) return 8;
  return null;
}

function decodeFixed(buffer, offset, type, length) {
  need(buffer, offset, length, 'fixed-length column');
  var value;
  if (type === TYPES.INT1) value = buffer[offset];
  else if (type === TYPES.BIT) value = buffer[offset] !== 0;
  else if (type === TYPES.INT2) value = buffer.readInt16LE(offset);
  else if (type === TYPES.INT4) value = buffer.readInt32LE(offset);
  else if (type === TYPES.INT8) value = buffer.readBigInt64LE(offset);
  else if (type === TYPES.FLOAT4) value = buffer.readFloatLE(offset);
  else if (type === TYPES.FLOAT8) value = buffer.readDoubleLE(offset);
  else throw new RangeError('Unsupported fixed SQL Server type 0x' + type.toString(16));
  return { value: value, offset: offset + length };
}

function decodeVariableNumeric(buffer, offset, column) {
  need(buffer, offset, 1, 'variable numeric length');
  var length = buffer[offset++];
  if (length === 0) return { value: null, offset: offset };
  need(buffer, offset, length, 'variable numeric value');
  var value;
  if (column.type === TYPES.BITN) {
    if (length !== 1) throw new RangeError('Invalid SQL Server BITN length ' + length);
    value = buffer[offset] !== 0;
  } else if (column.type === TYPES.INTN) {
    if (length === 1) value = buffer[offset];
    else if (length === 2) value = buffer.readInt16LE(offset);
    else if (length === 4) value = buffer.readInt32LE(offset);
    else if (length === 8) value = buffer.readBigInt64LE(offset);
    else throw new RangeError('Invalid SQL Server INTN length ' + length);
  } else if (column.type === TYPES.FLOATN) {
    if (length === 4) value = buffer.readFloatLE(offset);
    else if (length === 8) value = buffer.readDoubleLE(offset);
    else throw new RangeError('Invalid SQL Server FLOATN length ' + length);
  }
  return { value: value, offset: offset + length };
}

function decodeCharacterOrBinary(buffer, offset, column) {
  need(buffer, offset, 2, 'character/binary length');
  var length = buffer.readUInt16LE(offset); offset += 2;
  if (length === 0xffff) return { value: null, offset: offset };
  if (column.maxLength === 0xffff) throw new RangeError('SQL Server PLP/MAX values are not supported by this result parser yet');
  need(buffer, offset, length, 'character/binary value');
  var end = offset + length;
  var value;
  if (column.type === TYPES.NVARCHAR || column.type === TYPES.NCHAR) value = buffer.toString('utf16le', offset, end);
  else if (column.type === TYPES.BIGVARCHAR || column.type === TYPES.BIGCHAR) value = buffer.toString('utf8', offset, end);
  else value = Buffer.from(buffer.subarray(offset, end));
  return { value: value, offset: end };
}

function decodeColumn(buffer, offset, column) {
  var length = fixedLength(column.type);
  if (length !== null) return decodeFixed(buffer, offset, column.type, length);
  if (column.type === TYPES.INTN || column.type === TYPES.BITN || column.type === TYPES.FLOATN) return decodeVariableNumeric(buffer, offset, column);
  if (column.type === TYPES.BIGVARCHAR || column.type === TYPES.BIGCHAR || column.type === TYPES.NVARCHAR || column.type === TYPES.NCHAR || column.type === TYPES.BIGVARBINARY || column.type === TYPES.BIGBINARY) return decodeCharacterOrBinary(buffer, offset, column);
  throw new RangeError('Unsupported SQL Server row type 0x' + column.type.toString(16));
}

function parseRow(buffer, offset, columns, nullCompressed) {
  var start = offset++;
  var bitmap = null;
  if (nullCompressed) {
    var bitmapLength = Math.ceil(columns.length / 8);
    need(buffer, offset, bitmapLength, 'NBCROW null bitmap');
    bitmap = buffer.subarray(offset, offset + bitmapLength);
    offset += bitmapLength;
  }
  var row = {};
  for (var index = 0; index < columns.length; index++) {
    var column = columns[index];
    var isNull = bitmap && (bitmap[Math.floor(index / 8)] & (1 << (index % 8))) !== 0;
    if (isNull) row[column.name] = null;
    else {
      var decoded = decodeColumn(buffer, offset, column);
      row[column.name] = decoded.value;
      offset = decoded.offset;
    }
  }
  return { row: Object.freeze(row), bytesConsumed: offset - start };
}

function parseResult(payload) {
  var buffer = Buffer.from(payload);
  var offset = 0;
  var columns = Object.freeze([]);
  var rows = [];
  var errors = [];
  var info = [];
  var done = null;
  while (offset < buffer.length) {
    var token = buffer[offset];
    var parsed;
    if (token === TOKENS.COLMETADATA) {
      parsed = parseColMetadata(buffer, offset);
      columns = parsed.columns;
    } else if (token === TOKENS.ROW || token === TOKENS.NBCROW) {
      parsed = parseRow(buffer, offset, columns, token === TOKENS.NBCROW);
      rows.push(parsed.row);
    } else if (token === TOKENS.ERROR || token === TOKENS.INFO) {
      parsed = TokenStream.parseMessage(buffer, offset, token === TOKENS.ERROR ? 'error' : 'info');
      if (parsed.type === 'error') errors.push(parsed); else info.push(parsed);
    } else if (token === TOKENS.ENVCHANGE) {
      parsed = TokenStream.parseEnvChange(buffer, offset);
    } else if (token === TOKENS.DONE || token === TOKENS.DONEPROC || token === TOKENS.DONEINPROC) {
      parsed = TokenStream.parseDone(buffer, offset);
      done = parsed;
    } else {
      throw new RangeError('Unsupported SQL Server result token 0x' + token.toString(16).padStart(2, '0'));
    }
    offset += parsed.bytesConsumed;
  }
  return Object.freeze({
    columns: columns,
    rows: Object.freeze(rows),
    errors: Object.freeze(errors),
    info: Object.freeze(info),
    done: done,
    rowCount: done && done.hasRowCount ? done.rowCount : BigInt(rows.length),
    success: errors.length === 0 && (!done || !done.error)
  });
}

exports.TYPES = TYPES;
exports.parseTypeInfo = parseTypeInfo;
exports.parseColMetadata = parseColMetadata;
exports.parseRow = parseRow;
exports.parseResult = parseResult;
