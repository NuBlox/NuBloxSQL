'use strict';

var crypto = require('crypto');

function xor(left, right) {
  if (!Buffer.isBuffer(left) || !Buffer.isBuffer(right)) throw new TypeError('xor requires Buffers');
  if (left.length !== right.length) throw new RangeError('xor buffers must have equal length');
  var out = Buffer.allocUnsafe(left.length);
  for (var i = 0; i < left.length; i++) out[i] = left[i] ^ right[i];
  return out;
}

function mysqlNativePassword(password, scramble) {
  if (!Buffer.isBuffer(scramble)) throw new TypeError('scramble must be a Buffer');
  var plain = Buffer.from(String(password || ''), 'utf8');
  if (!plain.length) return Buffer.alloc(0);
  var stage1 = crypto.createHash('sha1').update(plain).digest();
  var stage2 = crypto.createHash('sha1').update(stage1).digest();
  var stage3 = crypto.createHash('sha1').update(Buffer.concat([scramble, stage2])).digest();
  return xor(stage1, stage3);
}

function cachingSha2Password(password, scramble) {
  if (!Buffer.isBuffer(scramble)) throw new TypeError('scramble must be a Buffer');
  var plain = Buffer.from(String(password || ''), 'utf8');
  if (!plain.length) return Buffer.alloc(0);
  var stage1 = crypto.createHash('sha256').update(plain).digest();
  var stage2 = crypto.createHash('sha256').update(stage1).digest();
  var stage3 = crypto.createHash('sha256').update(Buffer.concat([stage2, scramble])).digest();
  return xor(stage1, stage3);
}

function cleartextPassword(password) {
  return Buffer.concat([Buffer.from(String(password || ''), 'utf8'), Buffer.from([0])]);
}

function scramblePasswordForRsa(password, scramble) {
  if (!Buffer.isBuffer(scramble) || !scramble.length) throw new TypeError('scramble must be a non-empty Buffer');
  var value = cleartextPassword(password);
  var out = Buffer.allocUnsafe(value.length);
  for (var i = 0; i < value.length; i++) out[i] = value[i] ^ scramble[i % scramble.length];
  return out;
}

function encryptCachingSha2Password(password, scramble, publicKey) {
  var transformed = scramblePasswordForRsa(password, scramble);
  return crypto.publicEncrypt({ key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, transformed);
}

exports.mysqlNativePassword = mysqlNativePassword;
exports.cachingSha2Password = cachingSha2Password;
exports.cleartextPassword = cleartextPassword;
exports.scramblePasswordForRsa = scramblePasswordForRsa;
exports.encryptCachingSha2Password = encryptCachingSha2Password;
