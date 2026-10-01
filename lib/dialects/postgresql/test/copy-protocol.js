'use strict';

var assert = require('assert');
var protocol = require('../lib/protocol');

function payload(message) { return message.subarray(5); }

var data = protocol.encodeCopyData('a,b\n1,2\n');
assert.strictEqual(String.fromCharCode(data[0]), 'd');
assert.strictEqual(payload(data).toString('utf8'), 'a,b\n1,2\n');

var done = protocol.encodeCopyDone();
assert.strictEqual(String.fromCharCode(done[0]), 'c');
assert.strictEqual(done.length, 5);

var fail = protocol.encodeCopyFail('source exploded');
assert.strictEqual(String.fromCharCode(fail[0]), 'f');
assert.strictEqual(payload(fail).toString('utf8'), 'source exploded\0');
assert.throws(function () { protocol.encodeCopyData(42); }, /CopyData/);
assert.throws(function () { protocol.encodeCopyFail('bad\0message'); }, /NUL/);

var copyResponse = Buffer.alloc(7);
copyResponse[0] = 0;
copyResponse.writeUInt16BE(2, 1);
copyResponse.writeUInt16BE(0, 3);
copyResponse.writeUInt16BE(1, 5);
assert.deepStrictEqual(protocol.decodeBackendMessage('G', copyResponse), { type: 'copyInResponse', format: 0, columnFormats: [0, 1] });
assert.deepStrictEqual(protocol.decodeBackendMessage('H', copyResponse), { type: 'copyOutResponse', format: 0, columnFormats: [0, 1] });
assert.deepStrictEqual(protocol.decodeBackendMessage('W', copyResponse), { type: 'copyBothResponse', format: 0, columnFormats: [0, 1] });
assert.deepStrictEqual(protocol.decodeBackendMessage('d', Buffer.from('chunk')), { type: 'copyData', data: Buffer.from('chunk') });
assert.deepStrictEqual(protocol.decodeBackendMessage('c', Buffer.alloc(0)), { type: 'copyDone' });
assert.throws(function () { protocol.decodeBackendMessage('G', Buffer.from([0, 0])); }, /CopyInResponse/);
assert.throws(function () { protocol.decodeBackendMessage('H', Buffer.from([2, 0, 0])); }, /overall format/);
assert.throws(function () {
  var invalid = Buffer.from([0, 0, 1, 0, 2]);
  protocol.decodeBackendMessage('G', invalid);
}, /column format/);
assert.throws(function () { protocol.decodeBackendMessage('c', Buffer.from([0])); }, /CopyDone/);

console.log('ok - PostgreSQL COPY protocol contracts');
