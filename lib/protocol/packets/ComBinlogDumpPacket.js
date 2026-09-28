'use strict';

var COM_BINLOG_DUMP = 0x12;

module.exports = ComBinlogDumpPacket;

function ComBinlogDumpPacket(options) {
  options = options || {};

  this.position = normalizeUInt32(options.position, 4, 'position');
  this.flags = normalizeUInt16(options.flags, 0, 'flags');
  this.serverId = normalizeUInt32(options.serverId, 1, 'serverId');
  this.filename = options.filename === undefined || options.filename === null
    ? ''
    : String(options.filename);
}

ComBinlogDumpPacket.prototype.write = function write(writer) {
  writer.writeUnsignedNumber(1, COM_BINLOG_DUMP);
  writer.writeUnsignedNumber(4, this.position);
  writer.writeUnsignedNumber(2, this.flags);
  writer.writeUnsignedNumber(4, this.serverId);
  writer.writeString(this.filename);
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
