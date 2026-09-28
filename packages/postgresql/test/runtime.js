'use strict';

var assert = require('assert');
var postgres = require('..');
var ScramSha256 = require('../lib/ScramSha256').ScramSha256;
var connection = require('../lib/Connection');

var query = postgres.protocol.encodeQuery('SELECT 1');
assert.strictEqual(String.fromCharCode(query[0]), 'Q');
assert.strictEqual(query.readUInt32BE(1), query.length - 1);
assert.strictEqual(query.subarray(5, query.length - 1).toString(), 'SELECT 1');
assert.strictEqual(query[query.length - 1], 0);

var terminate = postgres.protocol.encodeTerminate();
assert.strictEqual(String.fromCharCode(terminate[0]), 'X');
assert.strictEqual(terminate.readUInt32BE(1), 4);

assert.strictEqual(connection.md5Password('user', 'password', Buffer.from([1, 2, 3, 4])), 'md5a3576f1ae039b8996bc4fc2720f9c71a');

var scram = new ScramSha256('user', 'pencil', { nonce: 'fyko+d2lbbFgONRv9qkxdawL' });
assert.strictEqual(scram.initialResponse(), 'n,,n=user,r=fyko+d2lbbFgONRv9qkxdawL');
var final = scram.continue('r=fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j,s=QSXCR+Q6sek8bf92,i=4096');
assert.ok(final.indexOf('c=biws,r=fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j,p=') === 0);
assert.doesNotThrow(function () { scram.verify('v=' + scram.serverSignature); });
assert.throws(function () { scram.verify('v=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='); }, /signature/);

assert.strictEqual(connection.decodeTextValue({ dataTypeOid: 23 }, Buffer.from('42')), 42);
assert.strictEqual(connection.decodeTextValue({ dataTypeOid: 16 }, Buffer.from('t')), true);
assert.deepStrictEqual(connection.decodeTextValue({ dataTypeOid: 3802 }, Buffer.from('{"a":1}')), { a: 1 });
assert.strictEqual(connection.decodeTextValue({ dataTypeOid: 25 }, null), null);

assert.strictEqual(connection.encodeTextParameter(42), '42');
assert.strictEqual(connection.encodeTextParameter(true), 'true');
assert.strictEqual(connection.encodeTextParameter(42n), '42');
assert.strictEqual(connection.encodeTextParameter(null), null);
assert.deepStrictEqual(connection.encodeTextParameter({ a: 1 }), '{"a":1}');
assert.throws(function () { connection.encodeTextParameter(Infinity); }, /finite/);

assert.strictEqual(typeof postgres.PreparedStatement, 'function');
assert.strictEqual(typeof postgres.PostgreSqlCancellationError, 'function');
assert.strictEqual(postgres.capabilities.preparedStatements, true);
assert.strictEqual(postgres.capabilities.serverSideCursors, false);
assert.strictEqual(postgres.capabilities.queryCancellation, true);
assert.strictEqual(postgres.capabilities.changeDataCapture, false);
assert.strictEqual(postgres.capabilities.savepoints, false);

var instance = postgres.createConnection({ user: 'test', ssl: false });
assert.ok(instance instanceof postgres.Connection);
assert.strictEqual(instance.connected, false);
assert.strictEqual(typeof instance.prepare, 'function');
assert.strictEqual(typeof instance.execute, 'function');
assert.strictEqual(typeof instance.cancel, 'function');

console.log('ok - PostgreSQL runtime contracts');
