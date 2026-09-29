'use strict';

var PacketReader = require('./PacketReader').PacketReader;
var client = require('./ClientPackets');
var types = require('./types');

var UNSIGNED_FLAG = 0x80;

function encodePrepare(sql) {
  return Buffer.concat([Buffer.from([0x16]), Buffer.from(String(sql), 'utf8')]);
}

function decodePrepareOk(payload) {
  var reader = new PacketReader(payload);
  if (reader.uint8() !== 0x00) throw new RangeError('Not a MySQL COM_STMT_PREPARE_OK packet');
  var statementId = reader.uint32LE();
  var numColumns = reader.uint16LE();
  var numParams = reader.uint16LE();
  reader.skip(1);
  var warningCount = reader.uint16LE();
  return { statementId: statementId, numColumns: numColumns, numParams: numParams, warningCount: warningCount };
}

function encodeDateTime(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError('Date parameter must be a valid Date');
  var out = Buffer.allocUnsafe(12);
  out[0] = 11;
  out.writeUInt16LE(value.getUTCFullYear(), 1);
  out[3] = value.getUTCMonth() + 1;
  out[4] = value.getUTCDate();
  out[5] = value.getUTCHours();
  out[6] = value.getUTCMinutes();
  out[7] = value.getUTCSeconds();
  out.writeUInt32LE(value.getUTCMilliseconds() * 1000, 8);
  return out;
}

function encodeParameter(value) {
  if (value === null || value === undefined) return { type: types.NULL, unsigned: false, bytes: Buffer.alloc(0), isNull: true };
  if (Buffer.isBuffer(value)) return { type: types.BLOB, unsigned: false, bytes: Buffer.concat([client.writeLengthEncodedInteger(value.length), value]), isNull: false };
  if (value instanceof Date) return { type: types.DATETIME, unsigned: false, bytes: encodeDateTime(value), isNull: false };
  if (typeof value === 'boolean') return { type: types.TINY, unsigned: true, bytes: Buffer.from([value ? 1 : 0]), isNull: false };
  if (typeof value === 'bigint') {
    var unsigned = value >= 0n;
    if (unsigned && value > 0xffffffffffffffffn) throw new RangeError('BigInt parameter exceeds unsigned 64-bit range');
    if (!unsigned && (value < -0x8000000000000000n || value > 0x7fffffffffffffffn)) throw new RangeError('BigInt parameter exceeds signed 64-bit range');
    var int64 = Buffer.allocUnsafe(8);
    if (unsigned) int64.writeBigUInt64LE(value);
    else int64.writeBigInt64LE(value);
    return { type: types.LONGLONG, unsigned: unsigned, bytes: int64, isNull: false };
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError('Number parameter must be finite');
    if (Number.isSafeInteger(value)) return encodeParameter(BigInt(value));
    var dbl = Buffer.allocUnsafe(8);
    dbl.writeDoubleLE(value, 0);
    return { type: types.DOUBLE, unsigned: false, bytes: dbl, isNull: false };
  }
  if (typeof value === 'string') {
    var text = Buffer.from(value, 'utf8');
    return { type: types.VAR_STRING, unsigned: false, bytes: Buffer.concat([client.writeLengthEncodedInteger(text.length), text]), isNull: false };
  }
  throw new TypeError('Unsupported MySQL prepared parameter type: ' + typeof value);
}

function encodeExecute(statementId, params, flags) {
  params = params || [];
  if (!Array.isArray(params)) throw new TypeError('params must be an array');
  if (!Number.isInteger(statementId) || statementId < 0 || statementId > 0xffffffff) throw new RangeError('statementId must be uint32');
  var head = Buffer.allocUnsafe(10);
  head[0] = 0x17;
  head.writeUInt32LE(statementId >>> 0, 1);
  head[5] = flags === undefined ? 0 : flags & 0xff;
  head.writeUInt32LE(1, 6);
  if (!params.length) return head;

  var encoded = params.map(encodeParameter);
  var nullBitmap = Buffer.alloc(Math.ceil(params.length / 8));
  var typeBytes = Buffer.allocUnsafe(params.length * 2);
  var values = [];
  for (var i = 0; i < encoded.length; i++) {
    var item = encoded[i];
    if (item.isNull) nullBitmap[Math.floor(i / 8)] |= 1 << (i % 8);
    typeBytes[i * 2] = item.type;
    typeBytes[i * 2 + 1] = item.unsigned ? UNSIGNED_FLAG : 0;
    if (!item.isNull) values.push(item.bytes);
  }
  return Buffer.concat([head, nullBitmap, Buffer.from([1]), typeBytes].concat(values));
}

function encodeClose(statementId) {
  var out = Buffer.allocUnsafe(5);
  out[0] = 0x19;
  out.writeUInt32LE(statementId >>> 0, 1);
  return out;
}

function encodeReset(statementId) {
  var out = Buffer.allocUnsafe(5);
  out[0] = 0x1a;
  out.writeUInt32LE(statementId >>> 0, 1);
  return out;
}

function isNull(bitmap, fieldIndex) {
  var bit = fieldIndex + 2;
  return (bitmap[Math.floor(bit / 8)] & (1 << (bit % 8))) !== 0;
}

function decodeTemporal(reader, type) {
  var length = reader.uint8();
  if (length === 0) return type === types.TIME ? '00:00:00' : '0000-00-00';
  if (type === types.TIME) {
    var negative = reader.uint8() === 1;
    var days = reader.uint32LE();
    var hour = reader.uint8();
    var minute = reader.uint8();
    var second = reader.uint8();
    var micros = length > 8 ? reader.uint32LE() : 0;
    var totalHours = days * 24 + hour;
    return (negative ? '-' : '') + String(totalHours).padStart(2, '0') + ':' + String(minute).padStart(2, '0') + ':' + String(second).padStart(2, '0') + (micros ? '.' + String(micros).padStart(6, '0') : '');
  }
  var year = reader.uint16LE();
  var month = reader.uint8();
  var day = reader.uint8();
  if (length === 4) return String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  var hours = reader.uint8();
  var minutes = reader.uint8();
  var seconds = reader.uint8();
  var microseconds = length > 7 ? reader.uint32LE() : 0;
  return String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0') + ' ' + String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0') + (microseconds ? '.' + String(microseconds).padStart(6, '0') : '');
}

function decodeBinaryValue(reader, field) {
  var unsigned = (field.flags & 0x20) !== 0;
  switch (field.type) {
    case types.TINY: {
      var tiny = reader.uint8();
      return unsigned ? tiny : (tiny > 127 ? tiny - 256 : tiny);
    }
    case types.SHORT:
    case types.YEAR: {
      reader.require(2);
      var shortValue = unsigned ? reader.buffer.readUInt16LE(reader.offset) : reader.buffer.readInt16LE(reader.offset);
      reader.offset += 2;
      return shortValue;
    }
    case types.LONG:
    case types.INT24: {
      reader.require(4);
      var longValue = unsigned ? reader.buffer.readUInt32LE(reader.offset) : reader.buffer.readInt32LE(reader.offset);
      reader.offset += 4;
      return longValue;
    }
    case types.LONGLONG: {
      reader.require(8);
      var big = unsigned ? reader.buffer.readBigUInt64LE(reader.offset) : reader.buffer.readBigInt64LE(reader.offset);
      reader.offset += 8;
      if (big <= BigInt(Number.MAX_SAFE_INTEGER) && big >= BigInt(Number.MIN_SAFE_INTEGER)) return Number(big);
      return big;
    }
    case types.FLOAT:
      reader.require(4); var f = reader.buffer.readFloatLE(reader.offset); reader.offset += 4; return f;
    case types.DOUBLE:
      reader.require(8); var d = reader.buffer.readDoubleLE(reader.offset); reader.offset += 8; return d;
    case types.DATE:
    case types.DATETIME:
    case types.TIMESTAMP:
    case types.TIME:
      return decodeTemporal(reader, field.type);
    case types.NULL:
      return null;
    default:
      return reader.lengthEncodedString('utf8');
  }
}

function decodeBinaryRow(payload, fields) {
  var reader = new PacketReader(payload);
  if (reader.uint8() !== 0x00) throw new RangeError('Not a MySQL binary protocol row');
  var bitmap = reader.bytes(Math.floor((fields.length + 7 + 2) / 8));
  var row = Object.create(null);
  for (var i = 0; i < fields.length; i++) row[fields[i].name] = isNull(bitmap, i) ? null : decodeBinaryValue(reader, fields[i]);
  if (reader.remaining()) throw new RangeError('Trailing bytes in MySQL binary row');
  return row;
}

exports.types = types;
exports.encodePrepare = encodePrepare;
exports.decodePrepareOk = decodePrepareOk;
exports.encodeParameter = encodeParameter;
exports.encodeExecute = encodeExecute;
exports.encodeClose = encodeClose;
exports.encodeReset = encodeReset;
exports.decodeBinaryRow = decodeBinaryRow;
