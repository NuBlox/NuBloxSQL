'use strict';

var capabilities = require('./capabilities');

function writeLengthEncodedInteger(value) {
  if (value === null) return Buffer.from([0xfb]);
  if (typeof value === 'bigint') {
    if (value < 0n) throw new RangeError('length-encoded integer must be non-negative');
    if (value <= 250n) return Buffer.from([Number(value)]);
    if (value <= 0xffffn) { var b2 = Buffer.allocUnsafe(3); b2[0] = 0xfc; b2.writeUInt16LE(Number(value), 1); return b2; }
    if (value <= 0xffffffn) { var b3 = Buffer.allocUnsafe(4); b3[0] = 0xfd; b3[1] = Number(value & 0xffn); b3[2] = Number((value >> 8n) & 0xffn); b3[3] = Number((value >> 16n) & 0xffn); return b3; }
    var b8 = Buffer.allocUnsafe(9); b8[0] = 0xfe; b8.writeBigUInt64LE(value, 1); return b8;
  }
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('length-encoded integer must be a non-negative safe integer');
  return writeLengthEncodedInteger(BigInt(value));
}

function encodeSslRequest(options) {
  options = options || {};
  var fixed = Buffer.alloc(32);
  fixed.writeUInt32LE(options.capabilities >>> 0, 0);
  fixed.writeUInt32LE(options.maxPacketSize === undefined ? 0x01000000 : options.maxPacketSize >>> 0, 4);
  fixed[8] = options.characterSet === undefined ? 45 : options.characterSet & 0xff;
  return fixed;
}

function encodeHandshakeResponse41(options) {
  options = options || {};
  var flags = options.capabilities >>> 0;
  var parts = [];
  parts.push(encodeSslRequest(options));
  parts.push(Buffer.from(String(options.user || ''), 'utf8'), Buffer.from([0]));

  var auth = Buffer.isBuffer(options.authResponse) ? options.authResponse : Buffer.from(options.authResponse || '');
  if (flags & capabilities.PLUGIN_AUTH_LENENC_CLIENT_DATA) parts.push(writeLengthEncodedInteger(auth.length), auth);
  else if (flags & capabilities.SECURE_CONNECTION) parts.push(Buffer.from([auth.length & 0xff]), auth);
  else parts.push(auth, Buffer.from([0]));

  if ((flags & capabilities.CONNECT_WITH_DB) && options.database) parts.push(Buffer.from(String(options.database), 'utf8'), Buffer.from([0]));
  if ((flags & capabilities.PLUGIN_AUTH) && options.authPluginName) parts.push(Buffer.from(String(options.authPluginName), 'utf8'), Buffer.from([0]));
  return Buffer.concat(parts);
}

function encodeQuery(sql) {
  return Buffer.concat([Buffer.from([0x03]), Buffer.from(String(sql), 'utf8')]);
}

function encodeQuit() { return Buffer.from([0x01]); }

exports.writeLengthEncodedInteger = writeLengthEncodedInteger;
exports.encodeSslRequest = encodeSslRequest;
exports.encodeHandshakeResponse41 = encodeHandshakeResponse41;
exports.encodeQuery = encodeQuery;
exports.encodeQuit = encodeQuit;
