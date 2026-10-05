'use strict';

var assert = require('assert');
var mysql = require('..');
var protocol = mysql.protocol;

function lenencString(value) {
  var bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([protocol.writeLengthEncodedInteger(bytes.length), bytes]);
}

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
  var bytes = Buffer.from([0xFA, 0xFB, 0xFC, 0x34, 0x12, 0xFD, 0x56, 0x34, 0x12, 0xFE, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x20, 0x00]);
  var reader = new protocol.PacketReader(bytes);
  assert.strictEqual(reader.lengthEncodedInteger(), 250);
  assert.strictEqual(reader.lengthEncodedInteger(), null);
  assert.strictEqual(reader.lengthEncodedInteger(), 0x1234);
  assert.strictEqual(reader.lengthEncodedInteger(), 0x123456);
  assert.strictEqual(reader.lengthEncodedInteger(), 9007199254740992n);
  assert.deepStrictEqual(Array.from(protocol.writeLengthEncodedInteger(250)), [250]);
  assert.deepStrictEqual(Array.from(protocol.writeLengthEncodedInteger(0x1234)), [0xfc, 0x34, 0x12]);
}

function buildHandshake() {
  var lower = protocol.capabilities.PROTOCOL_41 | protocol.capabilities.SECURE_CONNECTION | protocol.capabilities.SSL;
  var upperFlags = protocol.capabilities.PLUGIN_AUTH | protocol.capabilities.SESSION_TRACK | protocol.capabilities.DEPRECATE_EOF;
  var flags = (lower | upperFlags) >>> 0;
  var auth1 = Buffer.from('12345678');
  var auth2 = Buffer.from('ABCDEFGHIJKL\0', 'ascii');
  var plugin = Buffer.from('caching_sha2_password\0', 'ascii');
  var fixed = Buffer.alloc(1 + 6 + 4 + 8 + 1 + 2 + 1 + 2 + 2 + 1 + 10);
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

function testHandshakeResponse() {
  var flags = protocol.capabilities.PROTOCOL_41 | protocol.capabilities.SECURE_CONNECTION | protocol.capabilities.PLUGIN_AUTH | protocol.capabilities.CONNECT_WITH_DB;
  var payload = protocol.encodeHandshakeResponse41({ capabilities: flags, user: 'stephen', authResponse: Buffer.from([1, 2, 3]), database: 'nublox', authPluginName: 'mysql_native_password' });
  assert.strictEqual(payload.readUInt32LE(0), flags >>> 0);
  assert.ok(payload.includes(Buffer.from('stephen\0')));
  assert.ok(payload.includes(Buffer.from('nublox\0')));
  assert.ok(payload.includes(Buffer.from('mysql_native_password\0')));
  assert.deepStrictEqual(Array.from(protocol.encodeQuery('SELECT 1').subarray(0, 1)), [0x03]);
  assert.deepStrictEqual(Array.from(protocol.encodeQuit()), [0x01]);
}

function testConnectionAttributes() {
  var attributes = {
    _client_name: 'nubloxsql',
    _client_version: '1.1.0',
    program_name: 'nubloxsql',
    workload: 'qualification'
  };
  var encoded = protocol.encodeConnectionAttributes(attributes);
  var reader = new protocol.PacketReader(encoded);
  var size = Number(reader.lengthEncodedInteger());
  assert.strictEqual(reader.remaining(), size);
  var decoded = {};
  while (reader.remaining()) decoded[reader.lengthEncodedString()] = reader.lengthEncodedString();
  assert.deepStrictEqual(decoded, attributes);

  var flags = protocol.capabilities.PROTOCOL_41 |
    protocol.capabilities.SECURE_CONNECTION |
    protocol.capabilities.PLUGIN_AUTH |
    protocol.capabilities.CONNECT_ATTRS;
  var payload = protocol.encodeHandshakeResponse41({
    capabilities: flags,
    user: 'stephen',
    authResponse: Buffer.from([1, 2, 3]),
    authPluginName: 'mysql_native_password',
    connectionAttributes: attributes
  });
  assert.ok(payload.subarray(payload.length - encoded.length).equals(encoded));
  assert.throws(function () {
    protocol.encodeConnectionAttributes({ large: 'x'.repeat(64 * 1024) });
  }, /64KB/);
}

function testOkAndErrorPackets() {
  var ok = protocol.decodeOkPacket(Buffer.from([0x00, 0x02, 0x07, 0x02, 0x00, 0x01, 0x00]));
  assert.strictEqual(ok.affectedRows, 2);
  assert.strictEqual(ok.lastInsertId, 7);
  assert.strictEqual(ok.statusFlags, 2);
  assert.strictEqual(ok.warnings, 1);
  var err = protocol.decodeErrorPacket(Buffer.concat([Buffer.from([0xff, 0x15, 0x04, 0x23]), Buffer.from('HY000boom', 'ascii')]));
  assert.strictEqual(err.code, 1045);
  assert.strictEqual(err.sqlState, 'HY000');
  assert.strictEqual(err.message, 'boom');
}

function testColumnAndTextRow() {
  var fixed = Buffer.alloc(13);
  fixed[0] = 0x0c;
  fixed.writeUInt16LE(45, 1);
  fixed.writeUInt32LE(64, 3);
  fixed[7] = 0xfd;
  fixed.writeUInt16LE(0, 8);
  fixed[10] = 0;
  var column = Buffer.concat([lenencString('def'), lenencString('nublox'), lenencString('widgets'), lenencString('widgets'), lenencString('name'), lenencString('name'), fixed]);
  var field = protocol.decodeColumnDefinition41(column);
  assert.strictEqual(field.schema, 'nublox');
  assert.strictEqual(field.name, 'name');
  var row = protocol.decodeTextRow(lenencString('alpha'), [field]);
  assert.strictEqual(row.name, 'alpha');
  var nullRow = protocol.decodeTextRow(Buffer.from([0xfb]), [field]);
  assert.strictEqual(nullRow.name, null);
}

function testAuthSwitch() {
  var packet = Buffer.concat([Buffer.from([0xfe]), Buffer.from('mysql_native_password\0', 'ascii'), Buffer.from('12345678901234567890\0', 'ascii')]);
  var decoded = protocol.decodeAuthSwitchRequest(packet);
  assert.strictEqual(decoded.pluginName, 'mysql_native_password');
  assert.strictEqual(decoded.pluginData.toString('ascii'), '12345678901234567890');
}

function testLimits() {
  assert.throws(function () { new protocol.PacketFramer({ maxPayloadBytes: -1 }); }, RangeError);
  assert.throws(function () { protocol.encodePacket(Buffer.alloc(0), 256); }, RangeError);
  assert.throws(function () { protocol.writeLengthEncodedInteger(-1); }, RangeError);
}

[testPacketFraming, testLengthEncodedValues, testHandshake, testHandshakeResponse, testConnectionAttributes, testOkAndErrorPackets, testColumnAndTextRow, testAuthSwitch, testLimits].forEach(function (test) {
  test();
  process.stdout.write('ok - ' + test.name + '\n');
});
