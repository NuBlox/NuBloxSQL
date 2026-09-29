'use strict';

var crypto = require('crypto');

function escapeName(value) {
  return String(value).replace(/=/g, '=3D').replace(/,/g, '=2C');
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function hash(data) {
  return crypto.createHash('sha256').update(data).digest();
}

function xor(a, b) {
  if (a.length !== b.length) throw new Error('SCRAM buffers must have equal length');
  var out = Buffer.alloc(a.length);
  for (var i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

function parseAttributes(message) {
  var result = Object.create(null);
  var parts = String(message).split(',');
  for (var i = 0; i < parts.length; i++) {
    var item = parts[i];
    var index = item.indexOf('=');
    if (index <= 0) throw new Error('Malformed SCRAM attribute');
    var key = item.slice(0, index);
    if (Object.prototype.hasOwnProperty.call(result, key)) throw new Error('Duplicate SCRAM attribute: ' + key);
    result[key] = item.slice(index + 1);
  }
  return result;
}

function ScramSha256(user, password, options) {
  options = options || {};
  this.user = String(user);
  this.password = String(password);
  this.nonce = options.nonce || crypto.randomBytes(18).toString('base64');
  this.clientFirstBare = 'n=' + escapeName(this.user) + ',r=' + this.nonce;
  this.serverSignature = null;
}

ScramSha256.prototype.initialResponse = function initialResponse() {
  return 'n,,' + this.clientFirstBare;
};

ScramSha256.prototype.continue = function continueScram(serverFirstMessage) {
  var attrs = parseAttributes(serverFirstMessage);
  if (!attrs.r || attrs.r.indexOf(this.nonce) !== 0) throw new Error('Invalid SCRAM server nonce');
  if (!attrs.s) throw new Error('SCRAM server-first message is missing salt');
  var iterations = Number(attrs.i);
  if (!Number.isInteger(iterations) || iterations < 4096 || iterations > 10000000) throw new Error('Invalid SCRAM iteration count');

  var salt = Buffer.from(attrs.s, 'base64');
  var saltedPassword = crypto.pbkdf2Sync(Buffer.from(this.password, 'utf8'), salt, iterations, 32, 'sha256');
  var clientKey = hmac(saltedPassword, 'Client Key');
  var storedKey = hash(clientKey);
  var clientFinalWithoutProof = 'c=biws,r=' + attrs.r;
  var authMessage = this.clientFirstBare + ',' + serverFirstMessage + ',' + clientFinalWithoutProof;
  var clientSignature = hmac(storedKey, authMessage);
  var clientProof = xor(clientKey, clientSignature).toString('base64');
  var serverKey = hmac(saltedPassword, 'Server Key');
  this.serverSignature = hmac(serverKey, authMessage).toString('base64');
  return clientFinalWithoutProof + ',p=' + clientProof;
};

ScramSha256.prototype.verify = function verify(serverFinalMessage) {
  var attrs = parseAttributes(serverFinalMessage);
  if (attrs.e) throw new Error('SCRAM authentication failed: ' + attrs.e);
  if (!attrs.v || !this.serverSignature) throw new Error('Malformed SCRAM server-final message');
  var actual = Buffer.from(attrs.v, 'base64');
  var expected = Buffer.from(this.serverSignature, 'base64');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new Error('SCRAM server signature verification failed');
  }
};

exports.ScramSha256 = ScramSha256;
exports.parseAttributes = parseAttributes;
