'use strict';

var assert = require('assert');
var Binlog = require('../../../binlog');
var Buffer = require('safe-buffer').Buffer;
var test   = require('utest');

function event(type, payload) {
  var size = 19 + payload.length;
  var buffer = Buffer.alloc(size);

  buffer[4] = type;
  buffer.writeUInt32LE(7, 5);
  buffer.writeUInt32LE(size, 9);
  payload.copy(buffer, 19);
  return buffer;
}

function writeUInt48LE(buffer, value, offset) {
  for (var index = 0; index < 6; index++) {
    buffer[offset + index] = Math.floor(value / Math.pow(256, index)) & 0xff;
  }
}

function tableMapPayload(tableId, database, table) {
  var databaseBuffer = Buffer.from(database);
  var tableBuffer = Buffer.from(table);
  var payload = Buffer.alloc(
    6 + 2 + 1 + databaseBuffer.length + 1 + 1 + tableBuffer.length + 1 + 1 + 1 + 1 + 1
  );
  var offset = 0;

  writeUInt48LE(payload, tableId, offset);
  offset += 6;
  payload.writeUInt16LE(0, offset);
  offset += 2;
  payload[offset++] = databaseBuffer.length;
  databaseBuffer.copy(payload, offset);
  offset += databaseBuffer.length;
  payload[offset++] = 0;
  payload[offset++] = tableBuffer.length;
  tableBuffer.copy(payload, offset);
  offset += tableBuffer.length;
  payload[offset++] = 0;
  payload[offset++] = 1;
  payload[offset++] = 3;
  payload[offset++] = 0;
  payload[offset] = 0;

  return payload;
}

function writeRowsPayload(tableId) {
  var payload = Buffer.alloc(13);
  writeUInt48LE(payload, tableId, 0);
  payload.writeUInt16LE(0, 6);
  payload.writeUInt16LE(2, 8);
  payload[10] = 1;
  payload[11] = 1;
  payload[12] = 0;
  return payload;
}

test('BinlogRowEventSafety', {
  'rejects a table-map snapshot larger than the retained byte budget': function() {
    var decoder = Binlog.createDecoder({maxTableMapBytes: 8});

    assert.throws(function() {
      decoder.decode(event(
        Binlog.EventTypes.TABLE_MAP_EVENT,
        tableMapPayload(1, 'nublox', 'oversized_table')
      ));
    }, function(error) {
      return error.code === 'BINLOG_TABLE_MAP_TOO_LARGE' && error.limit === 8;
    });
  },

  'evicts oldest table maps when the retained byte budget is reached': function() {
    var decoder = Binlog.createDecoder({maxTableMapBytes: 13});

    decoder.decode(event(Binlog.EventTypes.TABLE_MAP_EVENT, tableMapPayload(1, 'db', 'one')));
    decoder.decode(event(Binlog.EventTypes.TABLE_MAP_EVENT, tableMapPayload(2, 'db', 'two')));

    var first = decoder.decode(event(Binlog.EventTypes.WRITE_ROWS_EVENT, writeRowsPayload(1)));
    var second = decoder.decode(event(Binlog.EventTypes.WRITE_ROWS_EVENT, writeRowsPayload(2)));

    assert.equal(first.tableMapMatched, false);
    assert.equal(second.tableMapMatched, true);
  },

  'does not expose mutable buffers retained by the decoder cache': function() {
    var decoder = Binlog.createDecoder();
    var tableId = 9;

    decoder.decode(event(Binlog.EventTypes.TABLE_MAP_EVENT, tableMapPayload(tableId, 'db', 'object')));

    var first = decoder.decode(event(Binlog.EventTypes.WRITE_ROWS_EVENT, writeRowsPayload(tableId)));
    first.tableMap.columnTypes[0] = 99;

    var second = decoder.decode(event(Binlog.EventTypes.WRITE_ROWS_EVENT, writeRowsPayload(tableId)));
    assert.equal(second.tableMap.columnTypes[0], 3);
  }
});
