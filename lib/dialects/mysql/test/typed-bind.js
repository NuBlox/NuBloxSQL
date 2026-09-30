'use strict';

var assert = require('assert');
var typed = require('../../../core/TypedValue').typed;
var packets = require('../lib/protocol/PreparedPackets');
var types = require('../lib/protocol/types');

function main() {
  var decimal = packets.encodeParameter(typed('12345678901234567890.123456', {
    type: 'decimal', precision: 26, scale: 6
  }));
  assert.strictEqual(decimal.type, types.NEWDECIMAL);
  assert.strictEqual(decimal.unsigned, false);
  assert.strictEqual(decimal.isNull, false);
  assert.strictEqual(decimal.bytes[0], decimal.bytes.length - 1);
  assert.strictEqual(decimal.bytes.subarray(1).toString('utf8'), '12345678901234567890.123456');

  var uuid = packets.encodeParameter(typed('00112233-4455-6677-8899-AABBCCDDEEFF', 'uuid'));
  assert.strictEqual(uuid.type, types.VAR_STRING);
  assert.strictEqual(uuid.isNull, false);
  assert.strictEqual(uuid.bytes.subarray(1).toString('utf8'), '00112233-4455-6677-8899-aabbccddeeff');

  var nullDecimal = packets.encodeParameter(typed(null, { type: 'decimal', precision: 20, scale: 4 }));
  assert.strictEqual(nullDecimal.type, types.NEWDECIMAL);
  assert.strictEqual(nullDecimal.isNull, true);

  var payload = packets.encodeExecute(7, [
    typed('12.34', { type: 'decimal', precision: 4, scale: 2 }),
    typed('00112233445566778899aabbccddeeff', 'uuid')
  ]);
  var nullBitmapLength = 1;
  var typeOffset = 10 + nullBitmapLength + 1;
  assert.strictEqual(payload[typeOffset], types.NEWDECIMAL);
  assert.strictEqual(payload[typeOffset + 2], types.VAR_STRING);

  console.log('NuBloxSQL MySQL portable typed decimal/UUID wire encoding passed');
}

main();
