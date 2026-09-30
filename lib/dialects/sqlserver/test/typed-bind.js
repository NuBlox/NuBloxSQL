'use strict';

var assert = require('assert');
var typed = require('../../../core/TypedValue').typed;
var Rpc = require('../lib/Rpc');

function readUnsignedBigIntLE(buffer, offset, length) { var value=0n;for(var i=length-1;i>=0;i--)value=(value<<8n)|BigInt(buffer[offset+i]);return value; }

function main() {
  var decimal = Rpc.infer(typed('12345678901234567890.123456', { type:'decimal', precision:26, scale:6 }));
  assert.strictEqual(decimal.definition, 'decimal(26,6)');
  assert.strictEqual(decimal.type[0], Rpc.TYPES.DECIMALN);
  assert.strictEqual(readUnsignedBigIntLE(decimal.data,2,12),12345678901234567890123456n);

  var uuid = Rpc.infer(typed('00112233-4455-6677-8899-AABBCCDDEEFF', 'uuid'));
  assert.strictEqual(uuid.definition, 'uniqueidentifier');
  assert.deepStrictEqual(uuid.data.subarray(1), Buffer.from('33221100554477668899aabbccddeeff','hex'));

  var date = Rpc.infer(typed('0001-01-01', 'date'));
  assert.strictEqual(date.definition, 'date');
  assert.deepStrictEqual(date.type, Buffer.from([Rpc.TYPES.DATE]));
  assert.deepStrictEqual(date.data, Buffer.from([3,0,0,0]));

  var leapDate = Rpc.infer(typed('2028-02-29', 'date'));
  assert.strictEqual(leapDate.data[0], 3);
  assert.ok(readUnsignedBigIntLE(leapDate.data,1,3) > 0n);

  var time = Rpc.infer(typed('09:07:05.120000', {type:'time',scale:6}));
  assert.strictEqual(time.definition, 'time(6)');
  assert.deepStrictEqual(time.type, Buffer.from([Rpc.TYPES.TIME,6]));
  assert.strictEqual(time.data[0],5);
  assert.strictEqual(readUnsignedBigIntLE(time.data,1,5),32825120000n);

  var timestamp = Rpc.infer(typed('2026-09-30 13:25:14.123000',{type:'timestamp',scale:6}));
  assert.strictEqual(timestamp.definition,'datetime2(6)');
  assert.deepStrictEqual(timestamp.type,Buffer.from([Rpc.TYPES.DATETIME2,6]));
  assert.strictEqual(timestamp.data[0],8);
  assert.strictEqual(readUnsignedBigIntLE(timestamp.data,1,5),48314123000n);
  assert.ok(readUnsignedBigIntLE(timestamp.data,6,3)>0n);

  var nullTime=Rpc.infer(typed(null,{type:'time',scale:3}));
  assert.strictEqual(nullTime.definition,'time(3)');
  assert.deepStrictEqual(nullTime.data,Buffer.from([0]));

  assert.strictEqual(Rpc.definitions([
    typed('2028-02-29','date'),
    typed('09:07:05.12',{type:'time',scale:2}),
    typed('2026-09-30 13:25:14.123',{type:'timestamp',scale:3})
  ]),'@p1 date, @p2 time(2), @p3 datetime2(3)');

  console.log('NuBloxSQL SQL Server portable typed decimal/UUID/temporal wire encoding passed');
}

main();
