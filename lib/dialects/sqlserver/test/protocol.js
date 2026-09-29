'use strict';

var assert = require('assert');
var tds = require('../lib/TdsPacket');
var prelogin = require('../lib/Prelogin');

function hex(value) { return Buffer.from(value.replace(/\s+/g, ''), 'hex'); }

var samplePacket = hex([
  '12 01 00 2F 00 00 01 00',
  '00 00 1A 00 06',
  '01 00 20 00 01',
  '02 00 21 00 01',
  '03 00 22 00 04',
  '04 00 26 00 01',
  'FF',
  '09 00 00 00 00 00',
  '01',
  '00',
  'B8 0D 00 00',
  '01'
].join(' '));

var encodedPayload = prelogin.encode({
  version: { major: 9, minor: 0, build: 0, subbuild: 0 },
  encryption: prelogin.ENCRYPTION.ON,
  instance: '',
  threadId: 3512,
  mars: true
});
var encodedPacket = tds.encodePacket({ type: tds.PACKET_TYPES.PRELOGIN, payload: encodedPayload });
assert.deepStrictEqual(encodedPacket, samplePacket);

var decodedPacket = tds.decodePacket(samplePacket);
assert.strictEqual(decodedPacket.type, tds.PACKET_TYPES.PRELOGIN);
assert.strictEqual(decodedPacket.length, 47);
assert.strictEqual(decodedPacket.endOfMessage, true);
assert.strictEqual(decodedPacket.packetId, 1);
var decodedPrelogin = prelogin.decode(decodedPacket.payload);
assert.strictEqual(decodedPrelogin.encryption, prelogin.ENCRYPTION.ON);
assert.strictEqual(decodedPrelogin.threadId, 3512);
assert.strictEqual(decodedPrelogin.mars, true);
assert.strictEqual(decodedPrelogin.entries[0].token, prelogin.TOKENS.VERSION);
assert.strictEqual(decodedPrelogin.version[0], 9);

var parser = new tds.PacketParser();
assert.deepStrictEqual(parser.push(samplePacket.subarray(0, 3)), []);
assert.strictEqual(parser.bufferedBytes(), 3);
assert.deepStrictEqual(parser.push(samplePacket.subarray(3, 20)), []);
var fragmented = parser.push(samplePacket.subarray(20));
assert.strictEqual(fragmented.length, 1);
assert.deepStrictEqual(fragmented[0].payload, decodedPacket.payload);
assert.strictEqual(parser.bufferedBytes(), 0);

var twoPackets = Buffer.concat([samplePacket, samplePacket]);
assert.strictEqual(new tds.PacketParser().push(twoPackets).length, 2);

var payload = Buffer.alloc(1200, 0x5a);
var chunks = tds.packetize(tds.PACKET_TYPES.SQL_BATCH, payload, { packetSize: 512 });
assert.strictEqual(chunks.length, 3);
assert.strictEqual(tds.decodePacket(chunks[0]).endOfMessage, false);
assert.strictEqual(tds.decodePacket(chunks[1]).endOfMessage, false);
assert.strictEqual(tds.decodePacket(chunks[2]).endOfMessage, true);
assert.deepStrictEqual(Buffer.concat(chunks.map(function (packet) { return tds.decodePacket(packet).payload; })), payload);

assert.throws(function () { tds.decodePacket(Buffer.from([0x12])); }, /Incomplete TDS packet header/);
assert.throws(function () {
  var invalid = Buffer.alloc(8);
  invalid.writeUInt16BE(7, 2);
  tds.decodePacket(invalid);
}, /Invalid TDS packet length/);
assert.throws(function () { prelogin.decode(Buffer.from([prelogin.TOKENS.VERSION, 0, 10, 0, 6, 0xff])); }, /outside payload/);
assert.throws(function () { prelogin.decode(Buffer.from([prelogin.TOKENS.ENCRYPTION, 0, 6, 0, 1, 0xff, 1])); }, /VERSION must be the first/);
assert.throws(function () { prelogin.encode({ nonce: Buffer.alloc(31) }); }, /exactly 32 bytes/);

console.log('NuBloxSQL SQL Server TDS protocol foundation passed');
