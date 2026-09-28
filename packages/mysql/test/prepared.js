'use strict';

var assert = require('assert');
var protocol = require('..').protocol;

function field(name, type, flags) { return { name: name, type: type, flags: flags || 0 }; }

function testPreparePackets() {
  var prepare = protocol.encodePrepare('SELECT ?, ?');
  assert.strictEqual(prepare[0], 0x16);
  assert.strictEqual(prepare.subarray(1).toString('utf8'), 'SELECT ?, ?');

  var ok = Buffer.alloc(12);
  ok[0] = 0x00;
  ok.writeUInt32LE(1234, 1);
  ok.writeUInt16LE(2, 5);
  ok.writeUInt16LE(3, 7);
  ok[9] = 0;
  ok.writeUInt16LE(7, 10);
  assert.deepStrictEqual(protocol.decodePrepareOk(ok), { statementId: 1234, numColumns: 2, numParams: 3, warningCount: 7 });

  var close = protocol.encodeClose(1234);
  assert.strictEqual(close[0], 0x19);
  assert.strictEqual(close.readUInt32LE(1), 1234);
  var reset = protocol.encodeReset(1234);
  assert.strictEqual(reset[0], 0x1a);
  assert.strictEqual(reset.readUInt32LE(1), 1234);
}

function testExecuteEncoding() {
  var packet = protocol.encodeExecute(42, [null, true, -7, 12.5, 9007199254740993n, 'NuBlox', Buffer.from([1, 2])]);
  assert.strictEqual(packet[0], 0x17);
  assert.strictEqual(packet.readUInt32LE(1), 42);
  assert.strictEqual(packet[5], 0);
  assert.strictEqual(packet.readUInt32LE(6), 1);
  assert.strictEqual(packet[10] & 1, 1);
  assert.strictEqual(packet[11], 1);
  assert.strictEqual(packet[12], protocol.types.NULL);
  assert.strictEqual(packet[14], protocol.types.TINY);
  assert.strictEqual(packet[15], 0x80);
  assert.strictEqual(packet[16], protocol.types.LONGLONG);
  assert.strictEqual(packet[17], 0);
  assert.strictEqual(packet[18], protocol.types.DOUBLE);
  assert.strictEqual(packet[20], protocol.types.LONGLONG);
  assert.strictEqual(packet[21], 0x80);
  assert.strictEqual(packet[22], protocol.types.VAR_STRING);
  assert.strictEqual(packet[24], protocol.types.BLOB);
}

function testBinaryRow() {
  var fields = [
    field('id', protocol.types.LONG),
    field('name', protocol.types.VAR_STRING),
    field('score', protocol.types.DOUBLE),
    field('missing', protocol.types.VAR_STRING)
  ];
  var header = Buffer.from([0x00, 0x20]);
  var id = Buffer.alloc(4); id.writeInt32LE(7);
  var name = Buffer.concat([Buffer.from([6]), Buffer.from('NuBlox')]);
  var score = Buffer.alloc(8); score.writeDoubleLE(12.5);
  var row = protocol.decodeBinaryRow(Buffer.concat([header, id, name, score]), fields);
  assert.strictEqual(row.id, 7);
  assert.strictEqual(row.name, 'NuBlox');
  assert.strictEqual(row.score, 12.5);
  assert.strictEqual(row.missing, null);
}

function testParameterValidation() {
  assert.throws(function () { protocol.encodeExecute(-1, []); }, RangeError);
  assert.throws(function () { protocol.encodeParameter(Infinity); }, RangeError);
  assert.throws(function () { protocol.encodeParameter({}); }, TypeError);
  var date = new Date('2026-09-28T14:00:01.250Z');
  var encoded = protocol.encodeParameter(date);
  assert.strictEqual(encoded.type, protocol.types.DATETIME);
  assert.strictEqual(encoded.bytes[0], 11);
}

[testPreparePackets, testExecuteEncoding, testBinaryRow, testParameterValidation].forEach(function (test) {
  test();
  process.stdout.write('ok - ' + test.name + '\n');
});
