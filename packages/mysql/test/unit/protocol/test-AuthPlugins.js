'use strict';

var assert = require('assert');
var Buffer = require('safe-buffer').Buffer;
var Crypto = require('crypto');
var path   = require('path');

var AuthPlugins = require(path.resolve(__dirname, '../../../lib/protocol/AuthPlugins'));

var scramble = Buffer.from('00112233445566778899aabbccddeeff00112233', 'hex');
var password = 'correct horse battery staple';
var token = AuthPlugins.calculateCachingSha2Token(password, scramble);
var passwordHash = Crypto.createHash('sha256').update(Buffer.from(password)).digest();
var doubleHash = Crypto.createHash('sha256').update(passwordHash).digest();
var challengeHash = Crypto.createHash('sha256')
  .update(Buffer.concat([doubleHash, scramble]))
  .digest();
var expected = Buffer.allocUnsafe(passwordHash.length);

for (var i = 0; i < expected.length; i++) {
  expected[i] = passwordHash[i] ^ challengeHash[i];
}

assert.deepStrictEqual(token, expected);
assert.deepStrictEqual(AuthPlugins.calculateCachingSha2Token('', scramble), Buffer.alloc(0));
assert.throws(function () {
  AuthPlugins.calculateCachingSha2Token(password, Buffer.alloc(19));
}, function (err) {
  return err.code === 'AUTH_PLUGIN_PROTOCOL_ERROR';
});

var caching = AuthPlugins.create('caching_sha2_password', {
  password                : password,
  allowPublicKeyRetrieval : false
});

assert.deepStrictEqual(caching.initial(scramble), expected);
assert.throws(function () {
  caching.next(Buffer.from([0x04]));
}, function (err) {
  return err.code === 'AUTH_PUBLIC_KEY_RETRIEVAL_DISABLED';
});

var pair = Crypto.generateKeyPairSync('rsa', {
  modulusLength     : 2048,
  publicKeyEncoding : {
    type   : 'spki',
    format : 'pem'
  },
  privateKeyEncoding: {
    type   : 'pkcs8',
    format : 'pem'
  }
});
var receivedKey = null;
var rsaPlugin = AuthPlugins.create('caching_sha2_password', {
  password                : password,
  allowPublicKeyRetrieval : true,
  onServerPublicKey       : function onServerPublicKey(key) {
    receivedKey = key;
  }
});

rsaPlugin.initial(scramble);
assert.deepStrictEqual(rsaPlugin.next(Buffer.from([0x04])), Buffer.from([0x02]));

var encrypted = rsaPlugin.next(Buffer.from(pair.publicKey));
var decrypted = Crypto.privateDecrypt({
  key      : pair.privateKey,
  oaepHash : 'sha1',
  padding  : Crypto.constants.RSA_PKCS1_OAEP_PADDING
}, encrypted);
var clear = Buffer.from(password + '\0');

for (var i = 0; i < clear.length; i++) {
  clear[i] ^= scramble[i % scramble.length];
}

assert.deepStrictEqual(decrypted, clear);
assert.ok(receivedKey);

assert.throws(function () {
  AuthPlugins.create('mysql_clear_password', {password: password}).initial(scramble);
}, function (err) {
  return err.code === 'AUTH_CLEAR_PASSWORD_INSECURE';
});

var customSteps = [];
var custom = AuthPlugins.create('custom_auth', {
  ssl         : {},
  authPlugins : {
    custom_auth: function customAuthFactory(context) {
      assert.strictEqual(context.pluginName, 'custom_auth');
      assert.strictEqual(context.secure, true);

      return function customAuth(data, step) {
        customSteps.push(step.phase);
        return global.Promise.resolve(Buffer.from([data.length]));
      };
    }
  }
});

custom.initial(Buffer.from([1, 2, 3])).then(function (result) {
  assert.deepStrictEqual(result, Buffer.from([3]));
  return custom.next(Buffer.from([4]));
}).then(function (result) {
  assert.deepStrictEqual(result, Buffer.from([1]));
  assert.deepStrictEqual(customSteps, ['initial', 'continue']);
}).catch(function (err) {
  process.nextTick(function () {
    throw err;
  });
});
