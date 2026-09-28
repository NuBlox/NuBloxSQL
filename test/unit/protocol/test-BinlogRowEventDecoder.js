'use strict';

var assert = require('assert');
var Binlog = require('../../../binlog');
var Buffer = require('safe-buffer').Buffer;
var test   = require('utest');

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

function writeUInt48LE(buffer, value, offset) {
  for (var index = 0; index < 6; index++) {
    buffer[offset + index] = Math.floor(value / Math.pow(256, index)) & 0xff;
  }
}

function tableMapPayload(tableId, database, table, columnTypes) {
  var databaseBuffer = Buffer.from(database);
  var tableBuffer = Buffer.from(table);
  var columnCount = columnTypes.length;
  var nullBitmapLength = Math.floor((columnCount + 7) / 8);
  var payload = Buffer.alloc(
    6 + 2 + 1 + databaseBuffer.length + 1 + 1 + tableBuffer.length + 1 +
    1 + columnCount + 1 + nullBitmapLength
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
  payload[offset++] = columnCount;
  columnTypes.copy(payload, offset);
  offset += columnCount;
  payload[offset++] = 0;

  return payload;
}

function rowPayload(type, tableId, columnCount, beforeBitmap, afterBitmap, rows) {
  var isV2 = type === Binlog.EventTypes.WRITE_ROWS_EVENT ||
    type === Binlog.EventTypes.UPDATE_ROWS_EVENT ||
    type === Binlog.EventTypes.DELETE_ROWS_EVENT;
  var update = type === Binlog.EventTypes.UPDATE_ROWS_EVENT ||
    type === Binlog.EventTypes.UPDATE_ROWS_EVENT_V1;
  var bitmapLength = Math.floor((columnCount + 7) / 8);
  var size = 8 + (isV2 ? 2 : 0) + 1 + bitmapLength + (update ? bitmapLength : 0) + rows.length;
  var payload = Buffer.alloc(size);
  var offset = 0;

  writeUInt48LE(payload, tableId, offset);
  offset += 6;
  payload.writeUInt16LE(1, offset);
  offset += 2;

  if (isV2) {
    payload.writeUInt16LE(2, offset);
    offset += 2;
  }

  payload[offset++] = columnCount;
  beforeBitmap.copy(payload, offset);
  offset += bitmapLength;

  if (update) {
    afterBitmap.copy(payload, offset);
    offset += bitmapLength;
  }

  rows.copy(payload, offset);
  return payload;
}

test('BinlogRowEventDecoder', {
  'correlates current write row events with table map metadata': function() {
    var decoder = Binlog.createDecoder();
    var tableId = 42;

    decoder.decode(event(
      Binlog.EventTypes.TABLE_MAP_EVENT,
      tableMapPayload(tableId, 'nublox', 'object', Buffer.from([3, 15]))
    ));

    var rows = Buffer.from([0x00, 0x2a, 0x00, 0x00, 0x00, 0x03, 0x66, 0x6f, 0x6f]);
    var decoded = decoder.decode(event(
      Binlog.EventTypes.WRITE_ROWS_EVENT,
      rowPayload(Binlog.EventTypes.WRITE_ROWS_EVENT, tableId, 2, Buffer.from([0x03]), null, rows)
    ));

    assert.equal(decoded.tableId, tableId);
    assert.equal(decoded.rowFlags, 1);
    assert.equal(decoded.rowColumnCount, 2);
    assert.equal(decoded.database, 'nublox');
    assert.equal(decoded.table, 'object');
    assert.equal(decoded.tableMapMatched, true);
    assert.deepEqual(decoded.columnsPresentAfter, Buffer.from([0x03]));
    assert.deepEqual(decoded.rowsPayload, rows);
    assert.equal(decoded.tableMap.columnCount, 2);
  },

  'decodes update before and after column image bitmaps': function() {
    var decoder = Binlog.createDecoder();
    var tableId = 77;

    decoder.decode(event(
      Binlog.EventTypes.TABLE_MAP_EVENT,
      tableMapPayload(tableId, 'nublox', 'position', Buffer.from([3, 3, 3]))
    ));

    var rows = Buffer.from([0xaa, 0xbb, 0xcc]);
    var decoded = decoder.decode(event(
      Binlog.EventTypes.UPDATE_ROWS_EVENT,
      rowPayload(
        Binlog.EventTypes.UPDATE_ROWS_EVENT,
        tableId,
        3,
        Buffer.from([0x03]),
        Buffer.from([0x05]),
        rows
      )
    ));

    assert.deepEqual(decoded.columnsPresentBefore, Buffer.from([0x03]));
    assert.deepEqual(decoded.columnsPresentAfter, Buffer.from([0x05]));
    assert.deepEqual(decoded.rowsPayload, rows);
  },

  'supports v1 row event framing': function() {
    var decoder = Binlog.createDecoder();
    var tableId = 12;
    var rows = Buffer.from([0x11, 0x22]);
    var decoded = decoder.decode(event(
      Binlog.EventTypes.DELETE_ROWS_EVENT_V1,
      rowPayload(Binlog.EventTypes.DELETE_ROWS_EVENT_V1, tableId, 1, Buffer.from([0x01]), null, rows)
    ));

    assert.equal(decoded.tableId, tableId);
    assert.equal(decoded.tableMapMatched, false);
    assert.deepEqual(decoded.extraData, Buffer.alloc(0));
    assert.deepEqual(decoded.columnsPresentBefore, Buffer.from([0x01]));
    assert.deepEqual(decoded.rowsPayload, rows);
  },

  'clears table map correlation on rotate': function() {
    var decoder = Binlog.createDecoder();
    var tableId = 18;

    decoder.decode(event(
      Binlog.EventTypes.TABLE_MAP_EVENT,
      tableMapPayload(tableId, 'nublox', 'object', Buffer.from([3]))
    ));

    var rotatePayload = Buffer.alloc(8 + 16);
    rotatePayload.writeUInt32LE(4, 0);
    rotatePayload.write('mysql-bin.000002', 8, 'utf8');
    decoder.decode(event(Binlog.EventTypes.ROTATE_EVENT, rotatePayload));

    var decoded = decoder.decode(event(
      Binlog.EventTypes.WRITE_ROWS_EVENT,
      rowPayload(Binlog.EventTypes.WRITE_ROWS_EVENT, tableId, 1, Buffer.from([0x01]), null, Buffer.from([1]))
    ));

    assert.equal(decoded.tableMapMatched, false);
  },

  'rejects row and table-map column count mismatch': function() {
    var decoder = Binlog.createDecoder();
    var tableId = 99;

    decoder.decode(event(
      Binlog.EventTypes.TABLE_MAP_EVENT,
      tableMapPayload(tableId, 'nublox', 'object', Buffer.from([3]))
    ));

    assert.throws(function() {
      decoder.decode(event(
        Binlog.EventTypes.WRITE_ROWS_EVENT,
        rowPayload(Binlog.EventTypes.WRITE_ROWS_EVENT, tableId, 2, Buffer.from([0x03]), null, Buffer.from([1]))
      ));
    }, function(error) {
      return error.code === 'BINLOG_ROWS_TABLE_MAP_MISMATCH';
    });
  },

  'bounds retained table map state': function() {
    var decoder = Binlog.createDecoder({maxTableMaps: 1});

    decoder.decode(event(
      Binlog.EventTypes.TABLE_MAP_EVENT,
      tableMapPayload(1, 'nublox', 'one', Buffer.from([3]))
    ));
    decoder.decode(event(
      Binlog.EventTypes.TABLE_MAP_EVENT,
      tableMapPayload(2, 'nublox', 'two', Buffer.from([3]))
    ));

    var decoded = decoder.decode(event(
      Binlog.EventTypes.WRITE_ROWS_EVENT,
      rowPayload(Binlog.EventTypes.WRITE_ROWS_EVENT, 1, 1, Buffer.from([0x01]), null, Buffer.from([1]))
    ));

    assert.equal(decoded.tableMapMatched, false);
  }
});
