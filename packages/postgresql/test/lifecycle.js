'use strict';

var assert = require('assert');
var postgres = require('..');

async function main() {
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
