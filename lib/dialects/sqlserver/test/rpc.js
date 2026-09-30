'use strict';

var assert = require('assert');
var Rpc = require('../lib/Rpc');
var Plp = require('../lib/Plp');

function main() {
  var payload = Rpc.encodeExecuteSql(
    'SELECT @p1 AS id, @p2 AS name, @p3 AS enabled, @p4 AS large_id',
    [42, 'Stephen', true, 9007199254740993n],
    0n
  );

  assert.strictEqual(payload.readUInt32LE(0), 22);
  assert.strictEqual(payload.readUInt16LE(8), 2);
  assert.strictEqual(payload.readBigUInt64LE(10), 0n);
  assert.strictEqual(payload.readUInt16LE(22), 0xffff);
  assert.strictEqual(payload.readUInt16LE(24), Rpc.PROC_ID_SP_EXECUTESQL);
  assert.strictEqual(payload.readUInt16LE(26), 0);
  assert.ok(payload.includes(Buffer.from('SELECT @p1 AS id, @p2 AS name, @p3 AS enabled, @p4 AS large_id','utf16le')));
  assert.ok(payload.includes(Buffer.from('@p1 int, @p2 nvarchar(4000), @p3 bit, @p4 bigint','utf16le')));
  assert.ok(payload.includes(Buffer.from('Stephen','utf16le')));

  assert.strictEqual(Rpc.infer(12).definition, 'int');
  assert.strictEqual(Rpc.infer(12n).definition, 'bigint');
  assert.strictEqual(Rpc.infer(1.25).definition, 'float');
  assert.strictEqual(Rpc.infer(false).definition, 'bit');
  assert.strictEqual(Rpc.infer('x').definition, 'nvarchar(4000)');
  assert.strictEqual(Rpc.infer(Buffer.from([1,2])).definition, 'varbinary(8000)');
  assert.strictEqual(Rpc.infer(null).definition, 'nvarchar(4000)');

  var longText = 'A'.repeat(5000);
  var text = Rpc.infer(longText);
  assert.strictEqual(text.definition, 'nvarchar(max)');
  assert.strictEqual(text.type[0], Rpc.TYPES.NVARCHAR);
  assert.strictEqual(text.type.readUInt16LE(1), Rpc.PLP_MAX_LENGTH);
  var decodedText = Plp.read(text.data, 0);
  assert.strictEqual(decodedText.unknownLength, true);
  assert.strictEqual(decodedText.value.toString('utf16le'), longText);
  assert.strictEqual(decodedText.offset, text.data.length);

  var longBinary = Buffer.alloc(9001, 0x5a);
  var binary = Rpc.infer(longBinary);
  assert.strictEqual(binary.definition, 'varbinary(max)');
  assert.strictEqual(binary.type[0], Rpc.TYPES.BIGVARBINARY);
  assert.strictEqual(binary.type.readUInt16LE(1), Rpc.PLP_MAX_LENGTH);
  var decodedBinary = Plp.read(binary.data, 0);
  assert.strictEqual(decodedBinary.unknownLength, true);
  assert.deepStrictEqual(decodedBinary.value, longBinary);
  assert.strictEqual(decodedBinary.offset, binary.data.length);

  var emptyPlp = Plp.read(Rpc.plpValue(Buffer.alloc(0)), 0);
  assert.strictEqual(emptyPlp.unknownLength, true);
  assert.deepStrictEqual(emptyPlp.value, Buffer.alloc(0));
  var nullPlp = Plp.read(Rpc.plpValue(null), 0);
  assert.strictEqual(nullPlp.value, null);
  assert.strictEqual(nullPlp.unknownLength, false);

  var longSql = 'SELECT @p1 AS payload /* ' + 'x'.repeat(5000) + ' */';
  var longPayload = Rpc.encodeExecuteSql(longSql, [longText], 0n);
  assert.ok(longPayload.includes(Buffer.from('nvarchar(max)', 'utf16le')));
  assert.ok(longPayload.includes(Buffer.from(longSql, 'utf16le')));

  assert.throws(function () { Rpc.encodeExecuteSql('SELECT @p1', [{}]); }, /Unsupported SQL Server RPC parameter type/);
  assert.throws(function () { Rpc.encodeExecuteSql('SELECT @p1', [Infinity]); }, /must be finite/);

  console.log('NuBloxSQL SQL Server sp_executesql RPC PLP/MAX encoding passed');
}

main();
