'use strict';

var assert = require('assert');
var Buffer = require('safe-buffer').Buffer;
var Binlog = require('../../../binlog');
var test   = require('utest');

var SID = Buffer.from('24bc78502c1611e6a0730242ac110002', 'hex');
var SID_TEXT = '24bc7850-2c16-11e6-a073-0242ac110002';

function event(type, payload) {
  payload = payload || Buffer.alloc(0);

  var size = 19 + payload.length;
  var buffer = Buffer.alloc(size);
  buffer.writeUInt32LE(1700000000, 0);
  buffer[4] = type;
  buffer.writeUInt32LE(7, 5);
  buffer.writeUInt32LE(size, 9);
  buffer.writeUInt32LE(1234, 13);
  payload.copy(buffer, 19);
  return buffer;
}

function writeUInt64LE(buffer, value, offset) {
  value = global.BigInt(value);
  for (var index = 0; index < 8; index++) {
    buffer[offset + index] = Number((value >> global.BigInt(index * 8)) & global.BigInt(0xff));
  }
}

function gtidPayload(gno, withLogicalClock) {
  var payload = Buffer.alloc(withLogicalClock ? 42 : 25);
  payload[0] = 1;
  SID.copy(payload, 1);
  writeUInt64LE(payload, gno, 17);

  if (withLogicalClock) {
    payload[25] = 2;
    writeUInt64LE(payload, 41, 26);
    writeUInt64LE(payload, 42, 34);
  }

  return payload;
}

function previousGtidsPayload() {
  var payload = Buffer.alloc(8 + 16 + 8 + 2 * 16);
  var offset = 0;

  writeUInt64LE(payload, 1, offset);
  offset += 8;
  SID.copy(payload, offset);
  offset += 16;
  writeUInt64LE(payload, 2, offset);
  offset += 8;
  writeUInt64LE(payload, 1, offset);
  writeUInt64LE(payload, 4, offset + 8);
  offset += 16;
  writeUInt64LE(payload, 10, offset);
  writeUInt64LE(payload, 12, offset + 8);

  return payload;
}

test('Binlog GTID event decoding', {
  'decodes GTID source UUID and bigint group number': function() {
    var decoded = Binlog.createDecoder().decode(
      event(Binlog.EventTypes.GTID_LOG_EVENT, gtidPayload('9007199254740993', false))
    );

    assert.deepEqual(decoded.sid, SID);
    assert.equal(decoded.sidText, SID_TEXT);
    assert.equal(decoded.gno, global.BigInt('9007199254740993'));
    assert.equal(decoded.gtid, SID_TEXT + ':9007199254740993');
    assert.equal(decoded.anonymous, false);
  },

  'decodes logical clock fields and preserves later extension bytes': function() {
    var payload = Buffer.concat([gtidPayload(43, true), Buffer.from([0xaa, 0xbb])]);
    var decoded = Binlog.createDecoder().decode(event(Binlog.EventTypes.GTID_LOG_EVENT, payload));

    assert.equal(decoded.logicalTimestampType, 2);
    assert.equal(decoded.lastCommitted, global.BigInt(41));
    assert.equal(decoded.sequenceNumber, global.BigInt(42));
    assert.deepEqual(decoded.gtidExtension, Buffer.from([0xaa, 0xbb]));
  },

  'decodes anonymous GTID without fabricating a GTID string': function() {
    var decoded = Binlog.createDecoder().decode(
      event(Binlog.EventTypes.ANONYMOUS_GTID_LOG_EVENT, gtidPayload(7, false))
    );

    assert.equal(decoded.anonymous, true);
    assert.equal(decoded.gtid, null);
    assert.equal(decoded.sidText, SID_TEXT);
    assert.equal(decoded.gno, global.BigInt(7));
  },

  'decodes previous GTID SID interval sets with exclusive interval ends': function() {
    var decoded = Binlog.createDecoder().decode(
      event(Binlog.EventTypes.PREVIOUS_GTIDS_LOG_EVENT, previousGtidsPayload())
    );

    assert.equal(decoded.previousGtidSidCount, 1);
    assert.equal(decoded.previousGtidIntervalCount, 2);
    assert.equal(decoded.previousGtids[0].sidText, SID_TEXT);
    assert.deepEqual(decoded.previousGtids[0].sid, SID);
    assert.equal(decoded.previousGtids[0].intervals[0].start, global.BigInt(1));
    assert.equal(decoded.previousGtids[0].intervals[0].end, global.BigInt(4));
    assert.equal(decoded.previousGtids[0].intervals[1].start, global.BigInt(10));
    assert.equal(decoded.previousGtids[0].intervals[1].end, global.BigInt(12));
  },

  'rejects truncated GTID fixed bodies': function() {
    assert.throws(function() {
      Binlog.createDecoder().decode(
        event(Binlog.EventTypes.GTID_LOG_EVENT, Buffer.alloc(24))
      );
    }, function(error) {
      return error.code === 'BINLOG_EVENT_TRUNCATED';
    });
  },

  'rejects invalid previous GTID intervals': function() {
    var payload = previousGtidsPayload();
    writeUInt64LE(payload, 4, 8 + 16 + 8);
    writeUInt64LE(payload, 4, 8 + 16 + 8 + 8);

    assert.throws(function() {
      Binlog.createDecoder().decode(
        event(Binlog.EventTypes.PREVIOUS_GTIDS_LOG_EVENT, payload)
      );
    }, function(error) {
      return error.code === 'BINLOG_GTID_SET_INVALID_INTERVAL';
    });
  },

  'rejects unbounded previous GTID SID counts before allocation': function() {
    var payload = Buffer.alloc(8);
    writeUInt64LE(payload, 65537, 0);

    assert.throws(function() {
      Binlog.createDecoder().decode(
        event(Binlog.EventTypes.PREVIOUS_GTIDS_LOG_EVENT, payload)
      );
    }, function(error) {
      return error.code === 'BINLOG_GTID_SET_TOO_LARGE' && error.limit === 65536;
    });
  }
});
