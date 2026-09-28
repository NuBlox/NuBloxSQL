'use strict';

var assert = require('assert');
var protocol = require('../lib/protocol');

function frame(type, payload) {
  var result = Buffer.alloc(5 + payload.length);
  result[0] = type.charCodeAt(0);
  result.writeUInt32BE(payload.length + 4, 1);
  payload.copy(result, 5);
  return result;
}

var ssl = protocol.encodeSSLRequest();
assert.strictEqual(ssl.length, 8);
assert.strictEqual(ssl.readUInt32BE(0), 8);
assert.strictEqual(ssl.readUInt32BE(4), 80877103);

var startup = protocol.encodeStartupMessage({ user: 'stephen', database: 'nublox', application_name: 'NuBloxSQL' });
assert.strictEqual(startup.readUInt32BE(0), startup.length);
assert.strictEqual(startup.readUInt32BE(4), protocol.constants.PROTOCOL_VERSION_3_0);
assert.ok(startup.includes(Buffer.from('user\0stephen\0')));
assert.strictEqual(startup[startup.length - 1], 0);
assert.throws(function () { protocol.encodeStartupMessage({ database: 'nublox' }); }, /user/);
assert.throws(function () { protocol.encodeStartupMessage({ user: 'bad\0user' }); }, /NUL/);

var parser = new protocol.BackendMessageParser();
var authOkPayload = Buffer.alloc(4); authOkPayload.writeUInt32BE(0, 0);
var readyPayload = Buffer.from('I');
var combined = Buffer.concat([frame('R', authOkPayload), frame('Z', readyPayload)]);
assert.deepStrictEqual(parser.push(combined.subarray(0, 6)), []);
var parsed = parser.push(combined.subarray(6));
assert.strictEqual(parsed.length, 2);
assert.deepStrictEqual(parsed[0], { type: 'authentication', code: 0 });
assert.deepStrictEqual(parsed[1], { type: 'readyForQuery', transactionStatus: 'I' });

var parameterPayload = Buffer.concat([
  Buffer.from('server_version\0'),
  Buffer.from('18.0\0')
]);
var parameter = protocol.decodeBackendMessage('S', parameterPayload);
assert.deepStrictEqual(parameter, { type: 'parameterStatus', name: 'server_version', value: '18.0' });

var keyPayload = Buffer.alloc(8);
keyPayload.writeUInt32BE(12345, 0);
Buffer.from([1, 2, 3, 4]).copy(keyPayload, 4);
var keyData = protocol.decodeBackendMessage('K', keyPayload);
assert.strictEqual(keyData.processId, 12345);
assert.deepStrictEqual(keyData.secretKey, Buffer.from([1, 2, 3, 4]));

var saslPayload = Buffer.concat([Buffer.from([0, 0, 0, 10]), Buffer.from('SCRAM-SHA-256\0SCRAM-SHA-256-PLUS\0\0')]);
var sasl = protocol.decodeBackendMessage('R', saslPayload);
assert.strictEqual(sasl.code, 10);
assert.deepStrictEqual(sasl.mechanisms, ['SCRAM-SHA-256', 'SCRAM-SHA-256-PLUS']);

var errorPayload = Buffer.from([83, 69, 82, 82, 79, 82, 0, 67, 50, 56, 48, 48, 48, 0, 77, 98, 97, 100, 0, 0]);
var error = protocol.decodeBackendMessage('E', errorPayload);
assert.strictEqual(error.type, 'errorResponse');
assert.strictEqual(error.fields.S, 'ERROR');
assert.strictEqual(error.fields.C, '28000');
assert.strictEqual(error.fields.M, 'bad');

var limited = new protocol.BackendMessageParser({ maxMessageSize: 8 });
assert.throws(function () { limited.push(frame('X', Buffer.alloc(5))); }, /maxMessageSize/);

var unknown = protocol.decodeBackendMessage('Y', Buffer.from([1, 2]));
assert.strictEqual(unknown.type, 'unknown');
assert.strictEqual(unknown.messageType, 'Y');
assert.deepStrictEqual(unknown.payload, Buffer.from([1, 2]));
