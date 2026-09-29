'use strict';

var crypto = require('crypto');
var mysql = require('../../lib/dialects/mysql');

var iterations = Number(process.env.NUBLOX_FUZZ_ITERATIONS || 10000);
var maxPayload = Number(process.env.NUBLOX_FUZZ_MAX_PAYLOAD || 2048);
if (!Number.isInteger(iterations) || iterations <= 0) throw new RangeError('NUBLOX_FUZZ_ITERATIONS must be positive');
if (!Number.isInteger(maxPayload) || maxPayload <= 0) throw new RangeError('NUBLOX_FUZZ_MAX_PAYLOAD must be positive');

for (var i = 0; i < iterations; i++) {
  var length = crypto.randomInt(0, maxPayload + 1);
  var payload = crypto.randomBytes(length);
  var sequence = i & 0xff;
  var encoded = mysql.protocol.encodePacket(payload, sequence);
  var framer = new mysql.protocol.PacketFramer({ maxPayloadBytes: maxPayload });
  var offset = 0;
  var packets = [];
  while (offset < encoded.length) {
    var remaining = encoded.length - offset;
    var chunk = Math.min(remaining, Math.max(1, crypto.randomInt(1, Math.min(remaining, 64) + 1)));
    packets = packets.concat(framer.push(encoded.subarray(offset, offset + chunk)));
    offset += chunk;
  }
  if (packets.length !== 1) throw new Error('fuzz framing packet count mismatch');
  if (packets[0].sequenceId !== sequence) throw new Error('fuzz framing sequence mismatch');
  if (!packets[0].payload.equals(payload)) throw new Error('fuzz framing payload mismatch');
}

console.log('ok - canonical MySQL packet framing fuzz (' + iterations + ' iterations)');
