'use strict';

var assert = require('assert');
var Binlog = require('../../../binlog');
var BinlogDump = require('../../../lib/protocol/sequences/BinlogDump');
var Buffer = require('safe-buffer').Buffer;
var PacketWriter = require('../../../lib/protocol/PacketWriter');
var Packets = require('../../../lib/protocol/packets');
var test = require('utest');

function eventBuffer(type, payload) {
  payload = payload || Buffer.alloc(0);
  var size = 19 + payload.length;
  var buffer = Buffer.alloc(size);
  buffer.writeUInt32LE(1700000000, 0);
  buffer[4] = type;
  buffer.writeUInt32LE(7, 5);
  buffer.writeUInt32LE(size, 9);
  buffer.writeUInt32LE(1234, 13);
  buffer.writeUInt16LE(0, 17);
  payload.copy(buffer, 19);
  return buffer;
}

test('BinlogDump', {
  'writes COM_BINLOG_DUMP request wire payload': function() {
    var packet = new Packets.ComBinlogDumpPacket({
      filename : 'mysql-bin.000123',
      position : 4,
      flags    : 1,
      serverId : 42
    });
    var writer = new PacketWriter();
    var parser = {incrementPacketNumber: function() { return 0; }};

    packet.write(writer);
    var wire = writer.toBuffer(parser);
    var payload = wire.slice(4);

    assert.equal(payload[0], 0x12);
    assert.equal(payload.readUInt32LE(1), 4);
    assert.equal(payload.readUInt16LE(5), 1);
    assert.equal(payload.readUInt32LE(7), 42);
    assert.equal(payload.toString('utf8', 11), 'mysql-bin.000123');
  },

  'validates request integer ranges': function() {
    assert.throws(function() {
      return new Packets.ComBinlogDumpPacket({position: -1});
    }, /position must be an unsigned 32-bit integer/);

    assert.throws(function() {
      return new Packets.ComBinlogDumpPacket({flags: 0x10000});
    }, /flags must be an unsigned 16-bit integer/);
  },

  'decodes network event packets through the bounded decoder': function() {
    var sequence = new BinlogDump({
      filename : 'mysql-bin.000123',
      serverId : 42
    });
    var observed = null;

    sequence.once('event', function(event) {
      observed = event;
    });

    var payload = Buffer.alloc(8);
    payload.writeUInt32LE(9, 0);
    payload.writeUInt32LE(0, 4);
    sequence.BinlogNetworkPacket({event: eventBuffer(Binlog.EventTypes.XID_EVENT, payload)});

    assert.ok(observed);
    assert.equal(observed.type, Binlog.EventTypes.XID_EVENT);
    assert.equal(observed.xid, global.BigInt(9));
  },

  'marks malformed binlog events fatal and ends the sequence': function() {
    var sequence = new BinlogDump({filename: 'mysql-bin.000123'});
    var observed = null;

    sequence.once('error', function(error) {
      observed = error;
    });

    sequence.BinlogNetworkPacket({event: Buffer.alloc(2)});

    assert.ok(observed);
    assert.equal(observed.code, 'BINLOG_EVENT_TRUNCATED');
    assert.equal(observed.fatal, true);
  },

  'creates a dedicated replication connection surface': function() {
    var connection = Binlog.createReplicationConnection({
      host : 'localhost',
      user : 'nublox'
    });

    assert.equal(typeof connection.binlogDump, 'function');
    assert.equal(connection._nubloxReplicationConnection, true);
    assert.equal(connection.state, 'disconnected');
  }
});
