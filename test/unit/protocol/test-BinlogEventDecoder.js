'use strict';

var assert = require('assert');
var Buffer = require('safe-buffer').Buffer;
var Binlog = require('../../../binlog');
var test   = require('utest');

function event(type, payload, options) {
  options = options || {};
  payload = payload || Buffer.alloc(0);

  var checksum = options.checksum || Buffer.alloc(0);
  var size = 19 + payload.length + checksum.length;
  var buffer = Buffer.alloc(size);

  buffer.writeUInt32LE(options.timestamp || 1700000000, 0);
  buffer[4] = type;
  buffer.writeUInt32LE(options.serverId || 7, 5);
  buffer.writeUInt32LE(size, 9);
  buffer.writeUInt32LE(options.logPosition || 1234, 13);
  buffer.writeUInt16LE(options.flags || 0, 17);
  payload.copy(buffer, 19);
  checksum.copy(buffer, 19 + payload.length);
  return buffer;
}

function writeUInt64LE(buffer, value, offset) {
  value = BigInt(value);
  for (var index = 0; index < 8; index++) {
    buffer[offset + index] = Number((value >> BigInt(index * 8)) & BigInt(0xff));
  }
}

test('BinlogEventDecoder', {
  'decodes common event header and unknown payload': function() {
    var decoder = Binlog.createDecoder();
    var decoded = decoder.decode(event(99, Buffer.from([1, 2, 3])));

    assert.equal(decoded.type, 99);
    assert.equal(decoded.typeName, 'UNKNOWN_EVENT_99');
    assert.equal(decoded.serverId, 7);
    assert.equal(decoded.logPosition, 1234);
    assert.deepEqual(decoded.payload, Buffer.from([1, 2, 3]));
  },

  'decodes rotate event with bigint position': function() {
    var payload = Buffer.alloc(8 + Buffer.byteLength('mysql-bin.000123'));
    writeUInt64LE(payload, BigInt('4294967297'), 0);
    payload.write('mysql-bin.000123', 8, 'utf8');

    var decoded = Binlog.createDecoder().decode(event(Binlog.EventTypes.ROTATE_EVENT, payload));

    assert.equal(decoded.position, BigInt('4294967297'));
    assert.equal(decoded.nextBinlog, 'mysql-bin.000123');
  },

  'decodes query event': function() {
    var schema = Buffer.from('nublox');
    var query = Buffer.from('INSERT INTO object VALUES (1)');
    var status = Buffer.from([0x01, 0x02]);
    var payload = Buffer.alloc(13 + status.length + schema.length + 1 + query.length);

    payload.writeUInt32LE(44, 0);
    payload.writeUInt32LE(3, 4);
    payload[8] = schema.length;
    payload.writeUInt16LE(0, 9);
    payload.writeUInt16LE(status.length, 11);
    status.copy(payload, 13);
    schema.copy(payload, 13 + status.length);
    payload[13 + status.length + schema.length] = 0;
    query.copy(payload, 14 + status.length + schema.length);

    var decoded = Binlog.createDecoder().decode(event(Binlog.EventTypes.QUERY_EVENT, payload));

    assert.equal(decoded.threadId, 44);
    assert.equal(decoded.executionTime, 3);
    assert.equal(decoded.schema, 'nublox');
    assert.equal(decoded.query, 'INSERT INTO object VALUES (1)');
    assert.deepEqual(decoded.statusVariables, status);
  },

  'decodes format description event': function() {
    var payload = Buffer.alloc(60);
    payload.writeUInt16LE(4, 0);
    payload.write('8.4.0-nublox', 2, 'utf8');
    payload.writeUInt32LE(1700000001, 52);
    payload[56] = 19;
    payload[57] = 13;
    payload[58] = 0;
    payload[59] = 8;

    var decoded = Binlog.createDecoder().decode(event(Binlog.EventTypes.FORMAT_DESCRIPTION_EVENT, payload));

    assert.equal(decoded.binlogVersion, 4);
    assert.equal(decoded.serverVersion, '8.4.0-nublox');
    assert.equal(decoded.commonHeaderLength, 19);
    assert.deepEqual(decoded.eventHeaderLengths, Buffer.from([13, 0, 8]));
  },

  'decodes xid event as bigint': function() {
    var payload = Buffer.alloc(8);
    writeUInt64LE(payload, BigInt('9007199254740993'), 0);

    var decoded = Binlog.createDecoder().decode(event(Binlog.EventTypes.XID_EVENT, payload));
    assert.equal(decoded.xid, BigInt('9007199254740993'));
  },

  'decodes table map event boundaries': function() {
    var database = Buffer.from('nublox');
    var table = Buffer.from('object');
    var payload = Buffer.alloc(6 + 2 + 1 + database.length + 1 + 1 + table.length + 1 + 1 + 2 + 1 + 1 + 1);
    var offset = 0;

    payload[offset++] = 0x01;
    payload[offset++] = 0x02;
    payload[offset++] = 0x03;
    payload[offset++] = 0x04;
    payload[offset++] = 0x05;
    payload[offset++] = 0x06;
    payload.writeUInt16LE(1, offset);
    offset += 2;
    payload[offset++] = database.length;
    database.copy(payload, offset);
    offset += database.length;
    payload[offset++] = 0;
    payload[offset++] = table.length;
    table.copy(payload, offset);
    offset += table.length;
    payload[offset++] = 0;
    payload[offset++] = 2;
    payload[offset++] = 3;
    payload[offset++] = 15;
    payload[offset++] = 1;
    payload[offset++] = 0x20;
    payload[offset++] = 0x01;

    var decoded = Binlog.createDecoder().decode(event(Binlog.EventTypes.TABLE_MAP_EVENT, payload));

    assert.equal(decoded.tableId, 0x060504030201);
    assert.equal(decoded.database, 'nublox');
    assert.equal(decoded.table, 'object');
    assert.equal(decoded.columnCount, 2);
    assert.deepEqual(decoded.columnTypes, Buffer.from([3, 15]));
    assert.deepEqual(decoded.columnMetadata, Buffer.from([0x20]));
    assert.deepEqual(decoded.nullBitmap, Buffer.from([0x01]));
  },

  'separates configured checksum bytes': function() {
    var checksum = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]);
    var decoded = Binlog.createDecoder({checksumBytes: 4}).decode(
      event(99, Buffer.from([1, 2]), {checksum: checksum})
    );

    assert.deepEqual(decoded.payload, Buffer.from([1, 2]));
    assert.deepEqual(decoded.checksum, checksum);
  },

  'rejects truncated and oversized events before decoding': function() {
    var decoder = Binlog.createDecoder({maxEventSize: 32});
    var oversized = event(99, Buffer.alloc(20));

    assert.throws(function() {
      decoder.decode(oversized);
    }, function(error) {
      return error.code === 'BINLOG_EVENT_TOO_LARGE' && error.limit === 32;
    });

    var truncated = event(99, Buffer.alloc(1));
    truncated.writeUInt32LE(truncated.length + 10, 9);

    assert.throws(function() {
      Binlog.createDecoder().decode(truncated);
    }, function(error) {
      return error.code === 'BINLOG_EVENT_TRUNCATED';
    });
  }
});
