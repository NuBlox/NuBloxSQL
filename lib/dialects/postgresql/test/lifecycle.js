'use strict';

var assert = require('assert');
var postgres = require('..');
var tlsPolicy = require('../lib/TlsPolicy');
var cancel = require('../lib/CancelRequest');

async function main() {
  // Valid explicit policy must not be silently relaxed or mutated.
  assert.strictEqual(tlsPolicy.normalizeSsl(undefined).mode, 'prefer');
  assert.strictEqual(tlsPolicy.normalizeSsl(null).mode, 'prefer');
  assert.strictEqual(tlsPolicy.normalizeSsl(false).mode, 'disable');
  assert.strictEqual(tlsPolicy.normalizeSsl(true).mode, 'require');
  assert.strictEqual(tlsPolicy.normalizeSsl('prefer').mode, 'prefer');
  assert.strictEqual(tlsPolicy.normalizeSsl({}).mode, 'require');
  assert.strictEqual(tlsPolicy.normalizeSsl({ mode: 'disable' }).mode, 'disable');
  assert.strictEqual(tlsPolicy.normalizeSsl({ mode: 'prefer' }).mode, 'prefer');
  assert.strictEqual(tlsPolicy.normalizeSsl({ mode: 'require', rejectUnauthorized: true }).mode, 'require');
  assert.strictEqual(cancel.normalizeSsl, tlsPolicy.normalizeSsl,
    'query and cancellation TLS policies must be identical');
  for (var invalid of [
    'requre', 'unknown', '', 17, [], { mode: 'requre' }, { mode: '' },
    { mode: null }, { mode: false }, { mode: 'Require' }, { mode: [] }
  ]) {
    assert.throws(function () { tlsPolicy.normalizeSsl(invalid); },
      /Invalid PostgreSQL ssl/,
      'invalid TLS configuration must fail closed');
    var invalidConnection = postgres.createConnection({
      user: 'test', host: '127.0.0.1', port: 1, ssl: invalid
    });
    await assert.rejects(function () { return invalidConnection.connect(); },
      /Invalid PostgreSQL ssl/,
      'TLS configuration must fail before TCP');
    assert.strictEqual(invalidConnection.socket, null);
    assert.strictEqual(invalidConnection._connectState, null);

    await assert.rejects(function () {
      return cancel.sendCancelRequest({
        host: '127.0.0.1', port: 1, ssl: invalid
      }, { processId: 1234, secretKey: Buffer.from([1, 2, 3, 4]) });
    }, /Invalid PostgreSQL ssl/, 'cancel TLS policy must fail before TCP');
  }

  var connection = postgres.createConnection({ user: 'test', ssl: false });

  assert.doesNotThrow(function () {
    connection._fail(new Error('promise-style failure without error listener'));
  });

  var written = [];
  connection.connected = true;
  connection.ended = false;
  connection.socket = {
    write: function (buffer) { written.push(buffer); },
    destroy: function () {}
  };

  await assert.rejects(function () {
    return connection.query('SELECT 1', { timeout: 0 });
  }, /positive number/);
  assert.strictEqual(connection._currentQuery, null);
  assert.strictEqual(written.length, 0);

  var controller = new AbortController();
  controller.abort(new Error('already aborted'));
  await assert.rejects(function () {
    return connection.query('SELECT 1', { signal: controller.signal });
  }, /already aborted/);
  assert.strictEqual(connection._currentQuery, null);
  assert.strictEqual(written.length, 0);
}

main().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
