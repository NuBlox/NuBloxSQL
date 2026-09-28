'use strict';

var BaseDecoder = require('./BinlogEventDecoder');
var Buffer      = require('safe-buffer').Buffer;
var EventTypes  = require('./EventTypes');
var GtidDecoder = require('./GtidEventDecoder');
var RowDecoder  = require('./RowEventDecoder');
var Util        = require('util');

var DEFAULT_MAX_TABLE_MAPS = 4096;

module.exports = BinlogDecoder;
Util.inherits(BinlogDecoder, BaseDecoder);

function BinlogDecoder(options) {
  options = options || {};
  BaseDecoder.call(this, options);

  this.maxTableMaps = normalizeMaxTableMaps(options.maxTableMaps);
  this._tableMaps = new global.Map();
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
  if (this._tableMaps.has(event.tableId)) {
    this._tableMaps.delete(event.tableId);
  }

  this._tableMaps.set(event.tableId, snapshotTableMap(event));

  while (this._tableMaps.size > this.maxTableMaps) {
    var oldest = this._tableMaps.keys().next();
    if (oldest.done) {
      break;
    }
    this._tableMaps.delete(oldest.value);
  }
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
  return Object.freeze({
    tableId        : event.tableId,
    database       : event.database,
    table          : event.table,
    columnCount    : event.columnCount,
    columnTypes    : Buffer.from(event.columnTypes || []),
    columnMetadata : Buffer.from(event.columnMetadata || []),
    nullBitmap     : Buffer.from(event.nullBitmap || []),
    extraData      : Buffer.from(event.extraData || [])
  });
}

function normalizeMaxTableMaps(value) {
  if (value === undefined) {
    return DEFAULT_MAX_TABLE_MAPS;
  }

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError('maxTableMaps must be a positive safe integer');
  }

  return value;
}
