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

function body(message) {
  assert.strictEqual(message.readUInt32BE(1), message.length - 1);
  return message.subarray(5);
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

var parse = protocol.encodeParse('stmt1', 'SELECT $1::int4', [23]);
assert.strictEqual(String.fromCharCode(parse[0]), 'P');
assert.deepStrictEqual(body(parse), Buffer.concat([
  Buffer.from('stmt1\0SELECT $1::int4\0'),
  Buffer.from([0x00, 0x01, 0x00, 0x00, 0x00, 0x17])
]));
assert.throws(function () { protocol.encodeParse('bad\0name', 'SELECT 1'); }, /NUL/);
assert.throws(function () { protocol.encodeParse('', 'SELECT $1', [-1]); }, /unsigned 32-bit/);

var bind = protocol.encodeBind({
  portal: 'portal1',
  statement: 'stmt1',
  parameterFormats: [0],
  parameters: ['42', null],
  resultFormats: [1]
});
assert.strictEqual(String.fromCharCode(bind[0]), 'B');
var bindBody = body(bind);
assert.ok(bindBody.subarray(0, 14).equals(Buffer.from('portal1\0stmt1\0')));
var bindOffset = 14;
assert.strictEqual(bindBody.readUInt16BE(bindOffset), 1); bindOffset += 2;
assert.strictEqual(bindBody.readUInt16BE(bindOffset), 0); bindOffset += 2;
assert.strictEqual(bindBody.readUInt16BE(bindOffset), 2); bindOffset += 2;
assert.strictEqual(bindBody.readInt32BE(bindOffset), 2); bindOffset += 4;
assert.strictEqual(bindBody.subarray(bindOffset, bindOffset + 2).toString(), '42'); bindOffset += 2;
assert.strictEqual(bindBody.readInt32BE(bindOffset), -1); bindOffset += 4;
assert.strictEqual(bindBody.readUInt16BE(bindOffset), 1); bindOffset += 2;
assert.strictEqual(bindBody.readUInt16BE(bindOffset), 1); bindOffset += 2;
assert.strictEqual(bindOffset, bindBody.length);
assert.throws(function () { protocol.encodeBind({ parameterFormats: [2] }); }, /0 \(text\) or 1 \(binary\)/);
assert.throws(function () { protocol.encodeBind({ parameters: [42] }); }, /strings/);

var describeStatement = protocol.encodeDescribe('S', 'stmt1');
assert.strictEqual(String.fromCharCode(describeStatement[0]), 'D');
assert.deepStrictEqual(body(describeStatement), Buffer.concat([Buffer.from('S'), Buffer.from('stmt1\0')]));
assert.throws(function () { protocol.encodeDescribe('X', 'stmt1'); }, /target/);

var execute = protocol.encodeExecute('portal1', 25);
assert.strictEqual(String.fromCharCode(execute[0]), 'E');
assert.strictEqual(body(execute).subarray(0, 8).toString('utf8'), 'portal1\0');
assert.strictEqual(body(execute).readUInt32BE(8), 25);
assert.throws(function () { protocol.encodeExecute('', -1); }, /unsigned 32-bit/);

var sync = protocol.encodeSync();
assert.strictEqual(String.fromCharCode(sync[0]), 'S');
assert.strictEqual(sync.length, 5);
assert.strictEqual(sync.readUInt32BE(1), 4);

assert.deepStrictEqual(protocol.decodeBackendMessage('1', Buffer.alloc(0)), { type: 'parseComplete' });
assert.deepStrictEqual(protocol.decodeBackendMessage('2', Buffer.alloc(0)), { type: 'bindComplete' });
assert.deepStrictEqual(protocol.decodeBackendMessage('3', Buffer.alloc(0)), { type: 'closeComplete' });
assert.deepStrictEqual(protocol.decodeBackendMessage('n', Buffer.alloc(0)), { type: 'noData' });
assert.deepStrictEqual(protocol.decodeBackendMessage('s', Buffer.alloc(0)), { type: 'portalSuspended' });
assert.throws(function () { protocol.decodeBackendMessage('1', Buffer.from([0])); }, /ParseComplete/);

var parameterDescriptionPayload = Buffer.alloc(10);
parameterDescriptionPayload.writeUInt16BE(2, 0);
parameterDescriptionPayload.writeUInt32BE(23, 2);
parameterDescriptionPayload.writeUInt32BE(25, 6);
assert.deepStrictEqual(protocol.decodeBackendMessage('t', parameterDescriptionPayload), {
  type: 'parameterDescription',
  parameterTypeOids: [23, 25]
});
assert.throws(function () { protocol.decodeBackendMessage('t', Buffer.from([0, 1])); }, /ParameterDescription/);

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

console.log('ok - PostgreSQL protocol contracts');
