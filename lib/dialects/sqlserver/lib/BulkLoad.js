'use strict';

var Rpc = require('./Rpc');
var ResultStream = require('./ResultStream');

var TOKENS = ResultStream.TOKENS;
var TYPES = ResultStream.TYPES;
var FLAGS_NULLABLE_UPDATEABLE = 0x0005;

function quoteIdentifier(value) {
  if (typeof value !== 'string' || !value.length) throw new TypeError('SQL Server bulk identifier must be non-empty');
  if (value.indexOf('\0') !== -1) throw new TypeError('SQL Server bulk identifier cannot contain NUL bytes');
  return '[' + value.replace(/\]/g, ']]') + ']';
}

function tableSql(parts) {
  if (!Array.isArray(parts) || !parts.length) throw new TypeError('SQL Server bulk table must be non-empty identifier parts');
  return parts.map(quoteIdentifier).join('.');
}

function bVarchar(value) {
  var encoded = Buffer.from(value, 'utf16le');
  if (value.length > 255) throw new RangeError('SQL Server bulk column name is too long');
  return Buffer.concat([Buffer.from([value.length]), encoded]);
}

function metadataColumn(name, typeInfo) {
  var header = Buffer.alloc(6);
  header.writeUInt32LE(0, 0);
  header.writeUInt16LE(FLAGS_NULLABLE_UPDATEABLE, 4);
  return Buffer.concat([header, typeInfo, bVarchar(name)]);
}

function colMetadata(columns) {
  var count = Buffer.alloc(2);
  count.writeUInt16LE(columns.length, 0);
  return Buffer.concat([Buffer.from([TOKENS.COLMETADATA]), count].concat(columns.map(function (column) {
    return metadataColumn(column.name, column.typeInfo);
  })));
}

function done() {
  var out = Buffer.alloc(13);
  out[0] = TOKENS.DONE;
  return out;
}

function intnType(width) { return Buffer.from([TYPES.INTN, width]); }
function fixedIntType(width) { return Buffer.from([width === 4 ? TYPES.INT4 : TYPES.INT8]); }
function bitnType() { return Buffer.from([TYPES.BITN, 1]); }
function fixedBitType() { return Buffer.from([TYPES.BIT]); }
function floatnType() { return Buffer.from([TYPES.FLOATN, 8]); }
function fixedFloatType() { return Buffer.from([TYPES.FLT8]); }
function nvarcharType(maxBytes) {
  var out = Buffer.alloc(8);
  out[0] = TYPES.NVARCHAR;
  out.writeUInt16LE(maxBytes, 1);
  Rpc.DEFAULT_COLLATION.copy(out, 3);
  return out;
}
function binaryType(maxBytes) {
  var out = Buffer.alloc(3);
  out[0] = TYPES.BIGVARBINARY;
  out.writeUInt16LE(maxBytes, 1);
  return out;
}

function intnValue(value, width) {
  if (value === null) return Buffer.from([0]);
  var out = Buffer.alloc(1 + width);
  out[0] = width;
  if (width === 4) out.writeInt32LE(value, 1);
  else out.writeBigInt64LE(typeof value === 'bigint' ? value : BigInt(value), 1);
  return out;
}
function fixedIntValue(value, width) {
  var out = Buffer.alloc(width);
  if (width === 4) out.writeInt32LE(value, 0);
  else out.writeBigInt64LE(typeof value === 'bigint' ? value : BigInt(value), 0);
  return out;
}
function bitnValue(value) {
  if (value === null) return Buffer.from([0]);
  return Buffer.from([1, value ? 1 : 0]);
}
function fixedBitValue(value) { return Buffer.from([value ? 1 : 0]); }
function floatnValue(value) {
  if (value === null) return Buffer.from([0]);
  var out = Buffer.alloc(9);
  out[0] = 8;
  out.writeDoubleLE(value, 1);
  return out;
}
function fixedFloatValue(value) { var out = Buffer.alloc(8); out.writeDoubleLE(value, 0); return out; }
function nvarcharValue(value, max) {
  if (max) return value === null ? Rpc.plpValue(null) : Rpc.plpValue(Buffer.from(value, 'utf16le'));
  if (value === null) return Buffer.from([0xff, 0xff]);
  var bytes = Buffer.from(value, 'utf16le');
  var length = Buffer.alloc(2);
  length.writeUInt16LE(bytes.length, 0);
  return Buffer.concat([length, bytes]);
}
function binaryValue(value, max) {
  if (max) return value === null ? Rpc.plpValue(null) : Rpc.plpValue(Buffer.from(value));
  if (value === null) return Buffer.from([0xff, 0xff]);
  var bytes = Buffer.from(value);
  var length = Buffer.alloc(2);
  length.writeUInt16LE(bytes.length, 0);
  return Buffer.concat([length, bytes]);
}

function classify(values) {
  var nonNull = values.filter(function (value) { return value !== null && value !== undefined; });
  var hasNull = nonNull.length !== values.length;
  if (!nonNull.length) {
    return { sqlType: 'nvarchar(4000)', typeInfo: nvarcharType(8000), encode: function (value) { return nvarcharValue(value, false); } };
  }

  var allBoolean = nonNull.every(function (value) { return typeof value === 'boolean'; });
  if (allBoolean) return hasNull
    ? { sqlType: 'bit', typeInfo: bitnType(), encode: bitnValue }
    : { sqlType: 'bit', typeInfo: fixedBitType(), encode: fixedBitValue };

  var allBigInt = nonNull.every(function (value) { return typeof value === 'bigint'; });
  if (allBigInt) return hasNull
    ? { sqlType: 'bigint', typeInfo: intnType(8), encode: function (value) { return intnValue(value, 8); } }
    : { sqlType: 'bigint', typeInfo: fixedIntType(8), encode: function (value) { return fixedIntValue(value, 8); } };

  var allNumber = nonNull.every(function (value) { return typeof value === 'number' && Number.isFinite(value); });
  if (allNumber) {
    var allInt32 = nonNull.every(function (value) { return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647; });
    if (allInt32) return hasNull
      ? { sqlType: 'int', typeInfo: intnType(4), encode: function (value) { return intnValue(value, 4); } }
      : { sqlType: 'int', typeInfo: fixedIntType(4), encode: function (value) { return fixedIntValue(value, 4); } };
    return hasNull
      ? { sqlType: 'float', typeInfo: floatnType(), encode: floatnValue }
      : { sqlType: 'float', typeInfo: fixedFloatType(), encode: fixedFloatValue };
  }

  var allString = nonNull.every(function (value) { return typeof value === 'string'; });
  if (allString) {
    var maxBytes = nonNull.reduce(function (max, value) { return Math.max(max, Buffer.byteLength(value, 'utf16le')); }, 0);
    var useMax = maxBytes > 8000;
    return {
      sqlType: useMax ? 'nvarchar(max)' : 'nvarchar(4000)',
      typeInfo: nvarcharType(useMax ? 0xffff : 8000),
      encode: function (value) { return nvarcharValue(value, useMax); }
    };
  }

  var allBinary = nonNull.every(function (value) { return Buffer.isBuffer(value) || ArrayBuffer.isView(value); });
  if (allBinary) {
    var maxBinary = nonNull.reduce(function (max, value) { return Math.max(max, value.byteLength); }, 0);
    var binaryMax = maxBinary > 8000;
    return {
      sqlType: binaryMax ? 'varbinary(max)' : 'varbinary(8000)',
      typeInfo: binaryType(binaryMax ? 0xffff : 8000),
      encode: function (value) { return binaryValue(value, binaryMax); }
    };
  }

  return null;
}

function build(tableParts, columnNames, rows) {
  if (!Array.isArray(columnNames) || !columnNames.length) throw new TypeError('SQL Server bulk columns must be a non-empty array');
  if (!Array.isArray(rows) || !rows.length) throw new TypeError('SQL Server bulk rows must be a non-empty array');

  var columns = [];
  for (var c = 0; c < columnNames.length; c += 1) {
    var name = columnNames[c];
    var values = rows.map(function (row) { return row[name] === undefined ? null : row[name]; });
    var type = classify(values);
    if (!type) return null;
    columns.push({
      name: name,
      sqlType: type.sqlType,
      typeInfo: type.typeInfo,
      encode: type.encode
    });
  }

  var statement = 'INSERT BULK ' + tableSql(tableParts) + ' (' + columns.map(function (column) {
    return quoteIdentifier(column.name) + ' ' + column.sqlType;
  }).join(', ') + ')';

  var payloadParts = [colMetadata(columns)];
  for (var r = 0; r < rows.length; r += 1) {
    var rowParts = [Buffer.from([TOKENS.ROW])];
    for (var i = 0; i < columns.length; i += 1) {
      var value = rows[r][columns[i].name];
      if (value === undefined) value = null;
      rowParts.push(columns[i].encode(value));
    }
    payloadParts.push(Buffer.concat(rowParts));
  }
  payloadParts.push(done());

  return Object.freeze({
    statement: statement,
    payload: Buffer.concat(payloadParts),
    columns: Object.freeze(columns.map(function (column) {
      return Object.freeze({ name: column.name, sqlType: column.sqlType });
    })),
    rowCount: rows.length
  });
}

exports.FLAGS_NULLABLE_UPDATEABLE = FLAGS_NULLABLE_UPDATEABLE;
exports.quoteIdentifier = quoteIdentifier;
exports.classify = classify;
exports.build = build;
