'use strict';

var assert = require('assert');
var mysql = require('..');
var protocol = mysql.protocol;

function testPacketFraming() {
  var first = protocol.encodePacket(Buffer.from('hello'), 0);
  var second = protocol.encodePacket(Buffer.from([1, 2, 3]), 1);
  var stream = Buffer.concat([first, second]);
  var framer = new protocol.PacketFramer();

  assert.deepStrictEqual(framer.push(stream.subarray(0, 2)), []);
  assert.deepStrictEqual(framer.push(stream.subarray(2, 7)), []);
  var packets = framer.push(stream.subarray(7));
  assert.strictEqual(packets.length, 2);
  assert.strictEqual(packets[0].sequenceId, 0);
  assert.strictEqual(packets[0].payload.toString('utf8'), 'hello');
  assert.strictEqual(packets[1].sequenceId, 1);
  assert.deepStrictEqual(Array.from(packets[1].payload), [1, 2, 3]);
}

function testLengthEncodedValues() {
  var bytes = Buffer.from([
    0xFA,
    0xFB,
    0xFC, 0x34, 0x12,
    0xFD, 0x56, 0x34, 0x12,
    0xFE, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x20, 0x00
  ]);
  var reader = new protocol.PacketReader(bytes);
  assert.strictEqual(reader.lengthEncodedInteger(), 250);
  assert.strictEqual(reader.lengthEncodedInteger(), null);
  assert.strictEqual(reader.lengthEncodedInteger(), 0x1234);
  assert.strictEqual(reader.lengthEncodedInteger(), 0x123456);
  assert.strictEqual(reader.lengthEncodedInteger(), 9007199254740992n);
}

function buildHandshake() {
  var lower = protocol.capabilities.PROTOCOL_41
    | protocol.capabilities.SECURE_CONNECTION
    | protocol.capabilities.SSL;
  var upperFlags = protocol.capabilities.PLUGIN_AUTH
    | protocol.capabilities.SESSION_TRACK
    | protocol.capabilities.DEPRECATE_EOF;
  var flags = (lower | upperFlags) >>> 0;
  var auth1 = Buffer.from('12345678');
  var auth2 = Buffer.from('ABCDEFGHIJKL\0', 'ascii');
  var plugin = Buffer.from('caching_sha2_password\0', 'ascii');
  var fixed = Buffer.alloc(1 + 6 + 1 + 4 + 8 + 1 + 2 + 1 + 2 + 2 + 1 + 10);
  var offset = 0;
  fixed[offset++] = 10;
  Buffer.from('8.4.0\0', 'ascii').copy(fixed, offset); offset += 6;
  fixed.writeUInt32LE(0x78563412, offset); offset += 4;
  auth1.copy(fixed, offset); offset += 8;
  fixed[offset++] = 0;
  fixed.writeUInt16LE(flags & 0xFFFF, offset); offset += 2;
  fixed[offset++] = 45;
  fixed.writeUInt16LE(0x0002, offset); offset += 2;
  fixed.writeUInt16LE((flags >>> 16) & 0xFFFF, offset); offset += 2;
  fixed[offset++] = 21;
  fixed.fill(0, offset, offset + 10);
  return Buffer.concat([fixed, auth2, plugin]);
}

function testHandshake() {
  var handshake = protocol.parseHandshakeV10(buildHandshake());
  assert.strictEqual(handshake.protocolVersion, 10);
  assert.strictEqual(handshake.serverVersion, '8.4.0');
  assert.strictEqual(handshake.connectionId, 0x78563412);
  assert.strictEqual(handshake.characterSet, 45);
  assert.strictEqual(handshake.statusFlags, 0x0002);
  assert.strictEqual(handshake.authPluginName, 'caching_sha2_password');
  assert.strictEqual(handshake.authPluginData.toString('ascii'), '12345678ABCDEFGHIJKL');
  assert.ok((handshake.capabilityFlags & protocol.capabilities.PROTOCOL_41) !== 0);
  assert.ok((handshake.capabilityFlags & protocol.capabilities.PLUGIN_AUTH) !== 0);
}

function testLimits() {
  assert.throws(function () {
    new protocol.PacketFramer({ maxPayloadBytes: -1 });
  }, RangeError);

  assert.throws(function () {
    protocol.encodePacket(Buffer.alloc(0), 256);
  }, RangeError);
}

[testPacketFraming, testLengthEncodedValues, testHandshake, testLimits].forEach(function (test) {
  test();
  process.stdout.write('ok - ' + test.name + '\n');
});
