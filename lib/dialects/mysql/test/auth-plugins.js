'use strict';

var assert = require('assert');
var mysql = require('..');

function testMatrixLifecycle() {
  var eight = mysql.authenticationPluginReport('8.4.11');
  var nine = mysql.authenticationPluginReport('9.7.0');
  function find(list, name) { return list.filter(function (entry) { return entry.name === name; })[0]; }
  assert.strictEqual(find(eight, 'caching_sha2_password').serverAvailability, 'default');
  assert.strictEqual(find(eight, 'mysql_native_password').serverAvailability, 'disabled-by-default');
  assert.strictEqual(find(nine, 'mysql_native_password').serverAvailability, 'removed');
  assert.strictEqual(find(nine, 'sha256_password').deprecated, true);
  assert.strictEqual(mysql.authenticationPlugin('authentication_webauthn_client', '9.7.0').clientSupport, 'unsupported');
}

function testSha256Policy() {
  var connection = new mysql.Connection({ user: 'u', password: 'p', ssl: false, getServerPublicKey: true });
  connection._connectState = { awaitingPublicKey: false, publicKeyPlugin: null };
  connection.secure = false;
  var request = connection._authToken('sha256_password', Buffer.from('12345678901234567890'));
  assert.deepStrictEqual(Array.from(request), [1]);
  assert.strictEqual(connection._connectState.awaitingPublicKey, true);
  assert.strictEqual(connection._connectState.publicKeyPlugin, 'sha256_password');

  var denied = new mysql.Connection({ user: 'u', password: 'p', ssl: false });
  denied._connectState = {};
  assert.throws(function () { denied._authToken('sha256_password', Buffer.alloc(20, 1)); }, /requires TLS/);
}

function testCleartextGuard() {
  var denied = new mysql.Connection({ user: 'u', password: 'secret', allowCleartextAuth: true });
  denied._connectState = {};
  denied.secure = false;
  assert.throws(function () { denied._authToken('mysql_clear_password', Buffer.alloc(20)); }, /requires TLS/);

  var optIn = new mysql.Connection({ user: 'u', password: 'secret', allowCleartextAuth: true });
  optIn._connectState = {};
  optIn.secure = true;
  assert.strictEqual(optIn._authToken('mysql_clear_password', Buffer.alloc(20)).toString('hex'), Buffer.from('secret\0').toString('hex'));

  var noOptIn = new mysql.Connection({ user: 'u', password: 'secret' });
  noOptIn._connectState = {};
  noOptIn.secure = true;
  assert.throws(function () { noOptIn._authToken('mysql_clear_password', Buffer.alloc(20)); }, /allowCleartextAuth/);
}

[testMatrixLifecycle, testSha256Policy, testCleartextGuard].forEach(function (test) {
  test();
  process.stdout.write('ok - ' + test.name + '\n');
});
