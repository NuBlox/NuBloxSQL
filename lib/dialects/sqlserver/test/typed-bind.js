'use strict';

var assert = require('assert');
var typed = require('../../../core/TypedValue').typed;
var Rpc = require('../lib/Rpc');

function readUnsignedBigIntLE(buffer, offset, length) {
  var value = 0n;
  for (var i = length - 1; i >= 0; i--) value = (value << 8n) | BigInt(buffer[offset + i]);
  return value;
}

function main() {
  var decimal = Rpc.infer(typed('12345678901234567890.123456', {
    type: 'decimal', precision: 26, scale: 6
  }));
  assert.strictEqual(decimal.definition, 'decimal(26,6)');
  assert.strictEqual(decimal.type[0], Rpc.TYPES.DECIMALN);
  assert.strictEqual(decimal.type[1], 13);
  assert.strictEqual(decimal.type[2], 26);
  assert.strictEqual(decimal.type[3], 6);
  assert.strictEqual(decimal.data[0], 13);
  assert.strictEqual(decimal.data[1], 1);
  assert.strictEqual(readUnsignedBigIntLE(decimal.data, 2, 12), 12345678901234567890123456n);

  var negative = Rpc.infer(typed('-12.3400', { type: 'decimal', precision: 6, scale: 4 }));
  assert.strictEqual(negative.data[1], 0);
  assert.strictEqual(readUnsignedBigIntLE(negative.data, 2, 4), 123400n);

  var nullDecimal = Rpc.infer(typed(null, { type: 'decimal', precision: 38, scale: 10 }));
  assert.strictEqual(nullDecimal.definition, 'decimal(38,10)');
  assert.strictEqual(nullDecimal.type[1], 17);
  assert.deepStrictEqual(nullDecimal.data, Buffer.from([0]));

  var uuid = Rpc.infer(typed('00112233-4455-6677-8899-AABBCCDDEEFF', 'uuid'));
  assert.strictEqual(uuid.definition, 'uniqueidentifier');
  assert.deepStrictEqual(uuid.type, Buffer.from([Rpc.TYPES.GUID, 16]));
  assert.strictEqual(uuid.data[0], 16);
  assert.deepStrictEqual(uuid.data.subarray(1), Buffer.from('33221100554477668899aabbccddeeff', 'hex'));

  var nullUuid = Rpc.infer(typed(null, 'uuid'));
  assert.strictEqual(nullUuid.definition, 'uniqueidentifier');
  assert.deepStrictEqual(nullUuid.data, Buffer.from([0]));

  assert.strictEqual(
    Rpc.definitions([
      typed('12.34', { type: 'decimal', precision: 4, scale: 2 }),
      typed('00112233445566778899aabbccddeeff', 'uuid')
    ]),
    '@p1 decimal(4,2), @p2 uniqueidentifier'
  );

  console.log('NuBloxSQL SQL Server portable typed decimal/UUID wire encoding passed');
}

main();
