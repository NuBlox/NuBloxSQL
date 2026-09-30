'use strict';

var assert = require('assert');
var typed = require('../../../core/TypedValue').typed;
var packets = require('../lib/protocol/PreparedPackets');
var types = require('../lib/protocol/types');

function main() {
  var decimal = packets.encodeParameter(typed('12345678901234567890.123456', { type:'decimal', precision:26, scale:6 }));
  assert.strictEqual(decimal.type, types.NEWDECIMAL);
  assert.strictEqual(decimal.bytes.subarray(1).toString('utf8'), '12345678901234567890.123456');

  var uuid = packets.encodeParameter(typed('00112233-4455-6677-8899-AABBCCDDEEFF', 'uuid'));
  assert.strictEqual(uuid.type, types.VAR_STRING);
  assert.strictEqual(uuid.bytes.subarray(1).toString('utf8'), '00112233-4455-6677-8899-aabbccddeeff');

  var date = packets.encodeParameter(typed('2028-02-29', 'date'));
  assert.strictEqual(date.type, types.DATE);
  assert.deepStrictEqual(Array.from(date.bytes), [4, 236, 7, 2, 29]);

  var time = packets.encodeParameter(typed('09:07:05.12', {type:'time',scale:6}));
  assert.strictEqual(time.type, types.TIME);
  assert.strictEqual(time.bytes[0], 12);
  assert.strictEqual(time.bytes[6], 9);
  assert.strictEqual(time.bytes[7], 7);
  assert.strictEqual(time.bytes[8], 5);
  assert.strictEqual(time.bytes.readUInt32LE(9), 120000);

  var timestamp = packets.encodeParameter(typed('2026-09-30 13:25:14.123', {type:'timestamp',scale:6}));
  assert.strictEqual(timestamp.type, types.DATETIME);
  assert.strictEqual(timestamp.bytes[0], 11);
  assert.strictEqual(timestamp.bytes.readUInt16LE(1), 2026);
  assert.strictEqual(timestamp.bytes[3], 9);
  assert.strictEqual(timestamp.bytes[4], 30);
  assert.strictEqual(timestamp.bytes[5], 13);
  assert.strictEqual(timestamp.bytes.readUInt32LE(8), 123000);

  var nullDate = packets.encodeParameter(typed(null, 'date'));
  assert.strictEqual(nullDate.type, types.DATE);
  assert.strictEqual(nullDate.isNull, true);

  var payload = packets.encodeExecute(7, [date, time].map(function (item, index) {
    return index === 0 ? typed('2028-02-29','date') : typed('09:07:05.12',{type:'time',scale:6});
  }));
  var typeOffset = 10 + 1 + 1;
  assert.strictEqual(payload[typeOffset], types.DATE);
  assert.strictEqual(payload[typeOffset + 2], types.TIME);

  console.log('NuBloxSQL MySQL portable typed decimal/UUID/temporal wire encoding passed');
}

main();
