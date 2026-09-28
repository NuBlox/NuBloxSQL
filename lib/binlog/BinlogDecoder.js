'use strict';

var BaseDecoder = require('./BinlogEventDecoder');
var Buffer      = require('safe-buffer').Buffer;
var EventTypes  = require('./EventTypes');
var GtidDecoder = require('./GtidEventDecoder');
var RowDecoder  = require('./RowEventDecoder');
var Util        = require('util');

var DEFAULT_MAX_TABLE_MAPS = 4096;
var DEFAULT_MAX_TABLE_MAP_BYTES = 16 * 1024 * 1024;

module.exports = BinlogDecoder;
Util.inherits(BinlogDecoder, BaseDecoder);

function BinlogDecoder(options) {
  options = options || {};
  BaseDecoder.call(this, options);

  this.maxTableMaps = normalizePositiveLimit(options.maxTableMaps, DEFAULT_MAX_TABLE_MAPS, 'maxTableMaps');
  this.maxTableMapBytes = normalizePositiveLimit(
    options.maxTableMapBytes,
    DEFAULT_MAX_TABLE_MAP_BYTES,
    'maxTableMapBytes'
  );
  this._tableMaps = new Map();
  this._tableMapBytes = 0;
}

BinlogDecoder.prototype.decode = function decode(input) {
  var event = BaseDecoder.prototype.decode.call(this, input);

  if (RowDecoder.isSupportedRowEvent(event.type)) {
    RowDecoder.decode(event, event.payload, this._tableMaps.get(eventTableId(event.payload)));
    return event;
  }

  switch (event.type) {
    case EventTypes.ROTATE_EVENT:
      this._tableMaps.clear();
      this._tableMapBytes = 0;
      break;
    case EventTypes.TABLE_MAP_EVENT:
      this._rememberTableMap(event);
      break;
    case EventTypes.GTID_LOG_EVENT:
      GtidDecoder.decodeGtidEvent(event, event.payload, false);
      break;
    case EventTypes.ANONYMOUS_GTID_LOG_EVENT:
      GtidDecoder.decodeGtidEvent(event, event.payload, true);
      break;
    case EventTypes.PREVIOUS_GTIDS_LOG_EVENT:
      GtidDecoder.decodePreviousGtidsEvent(event, event.payload);
      break;
  }

  return event;
};

BinlogDecoder.prototype._rememberTableMap = function _rememberTableMap(event) {
  var snapshot = snapshotTableMap(event);

  if (snapshot.retainedBytes > this.maxTableMapBytes) {
    var limitError = new Error(
      'TABLE_MAP_EVENT retained metadata exceeds maxTableMapBytes: ' +
        snapshot.retainedBytes + ' > ' + this.maxTableMapBytes
    );
    limitError.code = 'BINLOG_TABLE_MAP_TOO_LARGE';
    limitError.retainedBytes = snapshot.retainedBytes;
    limitError.limit = this.maxTableMapBytes;
    throw limitError;
  }

  this._deleteTableMap(event.tableId);
  this._tableMaps.set(event.tableId, snapshot);
  this._tableMapBytes += snapshot.retainedBytes;

  while (this._tableMaps.size > this.maxTableMaps || this._tableMapBytes > this.maxTableMapBytes) {
    var oldest = this._tableMaps.keys().next();
    if (oldest.done) {
      break;
    }
    this._deleteTableMap(oldest.value);
  }
};

BinlogDecoder.prototype._deleteTableMap = function _deleteTableMap(tableId) {
  var existing = this._tableMaps.get(tableId);
  if (!existing) {
    return;
  }

  this._tableMapBytes -= existing.retainedBytes;
  this._tableMaps.delete(tableId);
};

function eventTableId(payload) {
  if (!payload || payload.length < 6) {
    return undefined;
  }

  return payload[0] +
    payload[1] * 0x100 +
    payload[2] * 0x10000 +
    payload[3] * 0x1000000 +
    payload[4] * 0x100000000 +
    payload[5] * 0x10000000000;
}

function snapshotTableMap(event) {
  var database = event.database || '';
  var table = event.table || '';
  var columnTypes = Buffer.from(event.columnTypes || []);
  var columnMetadata = Buffer.from(event.columnMetadata || []);
  var nullBitmap = Buffer.from(event.nullBitmap || []);
  var extraData = Buffer.from(event.extraData || []);
  var retainedBytes = Buffer.byteLength(database) + Buffer.byteLength(table) +
    columnTypes.length + columnMetadata.length + nullBitmap.length + extraData.length;

  return Object.freeze({
    tableId        : event.tableId,
    database       : database,
    table          : table,
    columnCount    : event.columnCount,
    columnTypes    : columnTypes,
    columnMetadata : columnMetadata,
    nullBitmap     : nullBitmap,
    extraData      : extraData,
    retainedBytes  : retainedBytes
  });
}

function normalizePositiveLimit(value, fallback, name) {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(name + ' must be a positive safe integer');
  }

  return value;
}
