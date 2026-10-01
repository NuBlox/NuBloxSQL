'use strict';

var assert = require('assert');
var postgres = require('..');
var runtime = require('../lib/NotificationConnection');

var payload = Buffer.alloc(4);
payload.writeUInt32BE(4242, 0);
payload = Buffer.concat([payload, Buffer.from('orders\0ready\0')]);
assert.deepStrictEqual(postgres.protocol.decodeBackendMessage('A', payload), {
  type: 'notificationResponse',
  processId: 4242,
  channel: 'orders',
  payload: 'ready'
});
assert.throws(function () {
  postgres.protocol.decodeBackendMessage('A', Buffer.from([0, 0, 0, 1, 120, 0]));
}, /NotificationResponse/);
assert.throws(function () {
  postgres.protocol.decodeBackendMessage('A', Buffer.concat([Buffer.from([0, 0, 0, 1]), Buffer.from('x\0y\0z') ]));
}, /NotificationResponse/);

var connection = new runtime.Connection({ user: 'test', ssl: false });
var observed = null;
connection.on('notification', function (notification) { observed = notification; });
connection._handleMessage({ type: 'notificationResponse', processId: 99, channel: 'alpha', payload: 'beta' });
assert.deepStrictEqual(observed, { processId: 99, channel: 'alpha', payload: 'beta' });
assert.ok(Object.isFrozen(observed));

var calls = [];
connection.query = function query(sql) { calls.push(['query', sql]); return Promise.resolve({ rows: [], fields: [], command: '', rowCount: 0 }); };
connection.execute = function execute(sql, parameters) { calls.push(['execute', sql, parameters]); return Promise.resolve({ rows: [], fields: [], command: '', rowCount: 0 }); };

Promise.resolve()
  .then(function () { return connection.listen('channel "one"'); })
  .then(function () { return connection.unlisten('channel "one"'); })
  .then(function () { return connection.unlistenAll(); })
  .then(function () { return connection.notify('channel "one"', 'payload'); })
  .then(function () {
    assert.deepStrictEqual(calls[0], ['query', 'LISTEN "channel ""one"""']);
    assert.deepStrictEqual(calls[1], ['query', 'UNLISTEN "channel ""one"""']);
    assert.deepStrictEqual(calls[2], ['query', 'UNLISTEN *']);
    assert.deepStrictEqual(calls[3], ['execute', 'SELECT pg_notify($1::text, $2::text)', ['channel "one"', 'payload']]);
    assert.throws(function () { runtime.quoteIdentifier(''); }, /non-empty/);
    assert.throws(function () { runtime.quoteIdentifier('bad\0channel'); }, /NUL/);
    assert.throws(function () { runtime.normalizePayload('bad\0payload'); }, /NUL/);
    console.log('ok - PostgreSQL asynchronous notification contracts');
  })
  .catch(function (error) { console.error(error); process.exitCode = 1; });
