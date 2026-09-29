'use strict';

var TOKENS = Object.freeze({
  COLMETADATA: 0x81,
  ERROR: 0xaa,
  INFO: 0xab,
  ROW: 0xd1,
  DONE: 0xfd,
  DONEPROC: 0xfe,
  DONEINPROC: 0xff
});

var TYPES = Object.freeze({
  INT1: 0x30,
  BIT: 0x32,
  INT2: 0x34,
  INT4: 0x38,
  FLT4: 0x3b,
  MONEY: 0x3c,
  DATETIME: 0x3d,
  FLT8: 0x3e,
  MONEY4: 0x7a,
  INT8: 0x7f
});

function need(buffer, offset, count, label) {
  if (offset + count > buffer.length) throw new RangeError('Incomplete SQL Server ' + label);
}

function typeWidth(type) {
  if (type === TYPES.INT1 || type === TYPES.BIT) return 1;
  if (type === TYPES.INT2) return 2;
  if (type === TYPES.INT4 || type === TYPES.FLT4 || type === TYPES.MONEY4) return 4;
  if (type === TYPES.INT8 || type === TYPES.FLT8 || type === TYPES.MONEY || type === TYPES.DATETIME) return 8;
  throw new RangeError('Unsupported SQL Server fixed result type 0x' + type.toString(16).padStart(2, '0'));
}

function readColumnName(buffer, offset) {
  need(buffer, offset, 1, 'column-name length');
  var chars = buffer[offset++];
  var bytes = chars * 2;
  need(buffer, offset, bytes, 'column name');
  return { value: buffer.toString('utf16le', offset, offset + bytes), offset: offset + bytes };
}

function parseColumnMetadata(buffer, offset) {
  need(buffer, offset, 3, 'COLMETADATA header');
  if (buffer[offset] !== TOKENS.COLMETADATA) throw new RangeError('Expected SQL Server COLMETADATA token');
  var count = buffer.readUInt16LE(offset + 1);
  var cursor = offset + 3;
  var columns = [];
  if (count === 0xffff) count = 0;
  for (var i = 0; i < count; i++) {
    need(buffer, cursor, 7, 'column metadata');
    var userType = buffer.readUInt32LE(cursor); cursor += 4;
    var flags = buffer.readUInt16LE(cursor); cursor += 2;
    var type = buffer[cursor++];
    var width = typeWidth(type);
    var name = readColumnName(buffer, cursor); cursor = name.offset;
    columns.push(Object.freeze({
      name: name.value,
      userType: userType,
      flags: flags,
      nullable: (flags & 0x0001) !== 0,
      type: type,
      width: width
    }));
  }
  return { columns: Object.freeze(columns), offset: cursor };
}

function decodeFixed(buffer, offset, column) {
  need(buffer, offset, column.width, 'row value');
  var value;
  if (column.type === TYPES.INT1) value = buffer[offset];
  else if (column.type === TYPES.BIT) value = buffer[offset] !== 0;
  else if (column.type === TYPES.INT2) value = buffer.readInt16LE(offset);
  else if (column.type === TYPES.INT4) value = buffer.readInt32LE(offset);
  else if (column.type === TYPES.INT8) value = buffer.readBigInt64LE(offset);
  else if (column.type === TYPES.FLT4) value = buffer.readFloatLE(offset);
  else if (column.type === TYPES.FLT8) value = buffer.readDoubleLE(offset);
  else throw new RangeError('SQL Server fixed result type is not decoded yet: 0x' + column.type.toString(16));
  return { value: value, offset: offset + column.width };
}

function parseRow(buffer, offset, columns) {
  if (buffer[offset] !== TOKENS.ROW) throw new RangeError('Expected SQL Server ROW token');
  var cursor = offset + 1;
  var row = {};
  for (var i = 0; i < columns.length; i++) {
    var decoded = decodeFixed(buffer, cursor, columns[i]);
    cursor = decoded.offset;
    row[columns[i].name] = decoded.value;
  }
  return { row: Object.freeze(row), offset: cursor };
}

function parseDone(buffer, offset) {
  need(buffer, offset, 13, 'DONE token');
  var token = buffer[offset];
  if (token !== TOKENS.DONE && token !== TOKENS.DONEPROC && token !== TOKENS.DONEINPROC) throw new RangeError('Expected SQL Server DONE token');
  var status = buffer.readUInt16LE(offset + 1);
  return {
    token: token,
    status: status,
    rowCount: buffer.readBigUInt64LE(offset + 5),
    hasRowCount: (status & 0x0010) !== 0,
    error: (status & 0x0102) !== 0,
    more: (status & 0x0001) !== 0,
    offset: offset + 13
  };
}

function skipVariableToken(buffer, offset, label) {
  need(buffer, offset, 3, label + ' token');
  var length = buffer.readUInt16LE(offset + 1);
  need(buffer, offset + 3, length, label + ' body');
  return offset + 3 + length;
}

function parse(payload) {
  var buffer = Buffer.from(payload);
  var cursor = 0;
  var columns = Object.freeze([]);
  var rows = [];
  var done = null;
  while (cursor < buffer.length) {
    var token = buffer[cursor];
    if (token === TOKENS.COLMETADATA) {
      var metadata = parseColumnMetadata(buffer, cursor);
      columns = metadata.columns;
      cursor = metadata.offset;
    } else if (token === TOKENS.ROW) {
      var parsedRow = parseRow(buffer, cursor, columns);
      rows.push(parsedRow.row);
      cursor = parsedRow.offset;
    } else if (token === TOKENS.DONE || token === TOKENS.DONEPROC || token === TOKENS.DONEINPROC) {
      done = parseDone(buffer, cursor);
      cursor = done.offset;
    } else if (token === TOKENS.INFO) {
      cursor = skipVariableToken(buffer, cursor, 'INFO');
    } else if (token === TOKENS.ERROR) {
      throw new RangeError('SQL Server ERROR result token parsing will be added before public query exposure');
    } else {
      throw new RangeError('Unsupported SQL Server result token 0x' + token.toString(16).padStart(2, '0'));
    }
  }
  return Object.freeze({
    columns: columns,
    rows: Object.freeze(rows),
    rowCount: done && done.hasRowCount ? done.rowCount : BigInt(rows.length),
    done: done ? Object.freeze({ status: done.status, rowCount: done.rowCount, error: done.error, more: done.more }) : null
  });
}

exports.TOKENS = TOKENS;
exports.TYPES = TYPES;
exports.parseColumnMetadata = parseColumnMetadata;
exports.parseRow = parseRow;
exports.parse = parse;
