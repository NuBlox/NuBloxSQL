'use strict';

var assert = require('assert');
var BinlogDump = require('../../../lib/protocol/sequences/BinlogDump');
var Buffer = require('safe-buffer').Buffer;
var GtidSet = require('../../../lib/binlog/GtidSet');
var PacketWriter = require('../../../lib/protocol/PacketWriter');
var Packets = require('../../../lib/protocol/packets');
var test = require('utest');

var SID = '24bc7850-2c16-11e6-a073-0242ac110002';

function wirePayload(packet) {
  var writer = new PacketWriter();
  var parser = {incrementPacketNumber: function() { return 0; }};
  packet.write(writer);
  return writer.toBuffer(parser).slice(4);
}

function readUInt64LE(buffer, offset) {
  var value = global.BigInt(0);
  for (var index = 0; index < 8; index++) {
    value |= global.BigInt(buffer[offset + index]) << global.BigInt(index * 8);
  }
  return value;
}

test('COM_BINLOG_DUMP_GTID', {
  'encodes canonical MySQL GTID sets with exclusive wire interval ends': function() {
    var encoded = GtidSet.encode(SID + ':1-3:8');

    assert.equal(readUInt64LE(encoded, 0), global.BigInt(1));
    assert.equal(encoded.slice(8, 24).toString('hex'), SID.replace(/-/g, ''));
    assert.equal(readUInt64LE(encoded, 24), global.BigInt(2));
    assert.equal(readUInt64LE(encoded, 32), global.BigInt(1));
    assert.equal(readUInt64LE(encoded, 40), global.BigInt(4));
    assert.equal(readUInt64LE(encoded, 48), global.BigInt(8));
    assert.equal(readUInt64LE(encoded, 56), global.BigInt(9));
  },

  'writes the GTID dump command layout and forces BINLOG_THROUGH_GTID': function() {
    var packet = new Packets.ComBinlogDumpGtidPacket({
      filename : 'binlog.000123',
      position : global.BigInt('4294967300'),
      flags    : 1,
      serverId : 42,
      gtidSet  : SID + ':1-3'
    });
    var payload = wirePayload(packet);
    var filenameLength = payload.readUInt32LE(7);
    var positionOffset = 11 + filenameLength;
    var gtidLengthOffset = positionOffset + 8;

    assert.equal(payload[0], 0x1e);
    assert.equal(payload.readUInt16LE(1), 0x05);
    assert.equal(payload.readUInt32LE(3), 42);
    assert.equal(filenameLength, Buffer.byteLength('binlog.000123'));
    assert.equal(payload.toString('utf8', 11, positionOffset), 'binlog.000123');
    assert.equal(readUInt64LE(payload, positionOffset), global.BigInt('4294967300'));
    assert.equal(payload.readUInt32LE(gtidLengthOffset), payload.length - gtidLengthOffset - 4);
  },

  'encodes the empty executed GTID set': function() {
    var encoded = GtidSet.encode('');
    assert.equal(encoded.length, 8);
    assert.equal(readUInt64LE(encoded, 0), global.BigInt(0));
  },

  'rejects tagged GTIDs until tagged wire encoding is implemented': function() {
    assert.throws(function() {
      GtidSet.encode(SID + ':blue:1-3');
    }, /Tagged GTIDs are not yet supported/);
  },

  'rejects overlapping or descending intervals': function() {
    assert.throws(function() {
      GtidSet.encode(SID + ':5-9:8-10');
    }, /ordered and non-overlapping/);
  },

  'rejects GNO values outside MySQL signed 63-bit range': function() {
    assert.throws(function() {
      GtidSet.encode(SID + ':9223372036854775808');
    }, /GTID interval must be within/);
  },

  'selects the GTID command when gtidSet is supplied': function() {
    var sequence = new BinlogDump({
      filename : '',
      position : 4,
      flags    : 1,
      serverId : 42,
      gtidSet  : SID + ':1'
    });
    var packet = null;

    sequence.once('packet', function(value) {
      packet = value;
    });
    sequence.start();

    assert.ok(packet instanceof Packets.ComBinlogDumpGtidPacket);
  }
});
