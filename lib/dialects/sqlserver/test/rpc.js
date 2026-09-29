'use strict';

var assert = require('assert');
var Rpc = require('../lib/Rpc');

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

  assert.throws(function () { Rpc.encodeExecuteSql('SELECT @p1', [{}]); }, /Unsupported SQL Server RPC parameter type/);
  assert.throws(function () { Rpc.encodeExecuteSql('SELECT @p1', [Infinity]); }, /must be finite/);
  assert.throws(function () { Rpc.encodeExecuteSql('SELECT @p1', ['x'.repeat(4001)]); }, /exceeds 4000/);

  console.log('NuBloxSQL SQL Server sp_executesql RPC encoding passed');
}

main();
