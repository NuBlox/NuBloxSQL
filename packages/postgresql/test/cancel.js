'use strict';

var assert = require('assert');
var postgres = require('..');

var key4 = Buffer.from([1, 2, 3, 4]);
var request = postgres.protocol.encodeCancelRequest(12345, key4);
assert.strictEqual(request.length, 16);
assert.strictEqual(request.readUInt32BE(0), 16);
assert.strictEqual(request.readUInt32BE(4), postgres.protocol.constants.CANCEL_REQUEST_CODE);
assert.strictEqual(request.readUInt32BE(8), 12345);
assert.deepStrictEqual(request.subarray(12), key4);

var key32 = Buffer.alloc(32, 7);
var request32 = postgres.protocol.encodeCancelRequest(42, key32);
assert.strictEqual(request32.length, 44);
assert.deepStrictEqual(request32.subarray(12), key32);

assert.throws(function () { postgres.protocol.encodeCancelRequest(-1, key4); }, /processId/);
assert.throws(function () { postgres.protocol.encodeCancelRequest(1, Buffer.alloc(3)); }, /4 to 256/);
assert.throws(function () { postgres.protocol.encodeCancelRequest(1, Buffer.alloc(257)); }, /4 to 256/);

assert.strictEqual(typeof postgres.PostgreSqlCancellationError, 'function');
assert.strictEqual(postgres.capabilities.queryCancellation, true);
var connection = postgres.createConnection({ user: 'test', ssl: false });
assert.strictEqual(typeof connection.cancel, 'function');
assert.strictEqual(connection.cancelGraceTimeout, 5000);

console.log('ok - PostgreSQL CancelRequest contracts');
