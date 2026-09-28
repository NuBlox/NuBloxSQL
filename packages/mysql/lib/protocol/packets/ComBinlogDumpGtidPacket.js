'use strict';

var Buffer  = require('safe-buffer').Buffer;
var GtidSet = require('../../binlog/GtidSet');

var BINLOG_THROUGH_GTID = 0x04;
var COM_BINLOG_DUMP_GTID = 0x1e;
var MAX_UINT64 = (global.BigInt(1) << global.BigInt(64)) - global.BigInt(1);

module.exports = ComBinlogDumpGtidPacket;

function ComBinlogDumpGtidPacket(options) {
  options = options || {};

  this.flags = normalizeUInt16(options.flags, 0, 'flags') | BINLOG_THROUGH_GTID;
  this.serverId = normalizeUInt32(options.serverId, 1, 'serverId');
  this.filename = options.filename === undefined || options.filename === null
    ? ''
    : String(options.filename);
  this.position = normalizeUInt64(options.position, global.BigInt(4), 'position');
  this.gtidSet = options.gtidSet === undefined || options.gtidSet === null
    ? ''
    : options.gtidSet;
  this.gtidData = GtidSet.encode(this.gtidSet);

  var filenameLength = Buffer.byteLength(this.filename, 'utf8');
  if (filenameLength > 0xffffffff) {
    throw new RangeError('filename exceeds the unsigned 32-bit protocol length');
  }

  if (this.gtidData.length > 0xffffffff) {
    throw new RangeError('encoded GTID set exceeds the unsigned 32-bit protocol length');
  }

  this.filenameLength = filenameLength;
}

ComBinlogDumpGtidPacket.prototype.write = function write(writer) {
  writer.writeUnsignedNumber(1, COM_BINLOG_DUMP_GTID);
  writer.writeUnsignedNumber(2, this.flags);
  writer.writeUnsignedNumber(4, this.serverId);
  writer.writeUnsignedNumber(4, this.filenameLength);
  writer.writeString(this.filename);
  writer.writeBuffer(uint64Buffer(this.position));
  writer.writeUnsignedNumber(4, this.gtidData.length);
  writer.writeBuffer(this.gtidData);
};

function normalizeUInt16(value, fallback, name) {
  if (value === undefined) {
    value = fallback;
  }

  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) {
    throw new TypeError(name + ' must be an unsigned 16-bit integer');
  }

  return value;
}

function normalizeUInt32(value, fallback, name) {
  if (value === undefined) {
    value = fallback;
  }

  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new TypeError(name + ' must be an unsigned 32-bit integer');
  }

  return value;
}

function normalizeUInt64(value, fallback, name) {
  if (value === undefined) {
    value = fallback;
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(name + ' must be a non-negative safe integer or bigint');
    }
    value = global.BigInt(value);
  }

  if (typeof value !== 'bigint' || value < global.BigInt(0) || value > MAX_UINT64) {
    throw new TypeError(name + ' must be an unsigned 64-bit integer');
  }

  return value;
}

function uint64Buffer(value) {
  var buffer = Buffer.allocUnsafe(8);

  for (var index = 0; index < 8; index++) {
    buffer[index] = Number((value >> global.BigInt(index * 8)) & global.BigInt(0xff));
  }

  return buffer;
}
