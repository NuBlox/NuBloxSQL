'use strict';

var OID = Object.freeze({
  BOOL: 16,
  BYTEA: 17,
  INT8: 20,
  INT2: 21,
  INT4: 23,
  OID: 26,
  JSON: 114,
  FLOAT4: 700,
  FLOAT8: 701,
  DATE: 1082,
  TIME: 1083,
  TIMESTAMP: 1114,
  TIMESTAMPTZ: 1184,
  INTERVAL: 1186,
  TIMETZ: 1266,
  NUMERIC: 1700,
  UUID: 2950,
  JSONB: 3802
});

function decodeFloat(text) {
  if (text === 'NaN') return NaN;
  if (text === 'Infinity') return Infinity;
  if (text === '-Infinity') return -Infinity;
  var value = Number(text);
  return Number.isNaN(value) ? text : value;
}

function decodeByteaEscape(text) {
  var bytes = [];
  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i);
    if (code !== 92) {
      bytes.push(code & 0xff);
      continue;
    }
    if (text[i + 1] === '\\') {
      bytes.push(92);
      i += 1;
      continue;
    }
    var octal = text.slice(i + 1, i + 4);
    if (/^[0-7]{3}$/.test(octal)) {
      bytes.push(parseInt(octal, 8));
      i += 3;
      continue;
    }
    throw new Error('Invalid PostgreSQL bytea escape sequence');
  }
  return Buffer.from(bytes);
}

function decodeBytea(text) {
  if (text.slice(0, 2) === '\\x') {
    var hex = text.slice(2);
    if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) throw new Error('Invalid PostgreSQL bytea hex value');
    return Buffer.from(hex, 'hex');
  }
  return decodeByteaEscape(text);
}

function decodeTimestampTz(text) {
  if (text === 'infinity' || text === '-infinity') return text;
  var value = new Date(text);
  return Number.isNaN(value.getTime()) ? text : value;
}

function decodeText(field, value) {
  if (value === null) return null;
  var text = value.toString('utf8');
  var oid = field && field.dataTypeOid;
  switch (oid) {
    case OID.BOOL: return text === 't';
    case OID.BYTEA: return decodeBytea(text);
    case OID.INT2:
    case OID.INT4:
    case OID.OID: return Number(text);
    case OID.INT8:
      try { return BigInt(text); } catch (error) { return text; }
    case OID.FLOAT4:
    case OID.FLOAT8: return decodeFloat(text);
    case OID.NUMERIC: return text;
    case OID.JSON:
    case OID.JSONB: return JSON.parse(text);
    case OID.TIMESTAMPTZ: return decodeTimestampTz(text);
    case OID.DATE:
    case OID.TIME:
    case OID.TIMESTAMP:
    case OID.INTERVAL:
    case OID.TIMETZ:
    case OID.UUID:
    default: return text;
  }
}

exports.OID = OID;
exports.decodeText = decodeText;
exports.decodeBytea = decodeBytea;
