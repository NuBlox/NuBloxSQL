'use strict';

var BinlogEventDecoder = require('../../binlog/BinlogEventDecoder');
var Packets            = require('../packets');
var Readable           = require('stream').Readable;
var Sequence           = require('./Sequence');
var Util               = require('util');

module.exports = BinlogDump;
Util.inherits(BinlogDump, Sequence);

function BinlogDump(options, callback) {
  options = options || {};
  Sequence.call(this, options, callback);

  this._connection = options.connection || null;
  this._decoder = options.decoder || new BinlogEventDecoder(options.decoderOptions);
  this._dumpOptions = {
    filename : options.filename,
    position : options.position,
    flags    : options.flags,
    serverId : options.serverId
  };
}

BinlogDump.prototype.start = function start() {
  this.emit('packet', new Packets.ComBinlogDumpPacket(this._dumpOptions));
};

BinlogDump.prototype.determinePacket = function determinePacket(firstByte) {
  if (firstByte === 0xff) {
    return Packets.ErrorPacket;
  }

  if (firstByte === 0xfe) {
    return Packets.EofPacket;
  }

  return Packets.BinlogNetworkPacket;
};

BinlogDump.prototype.BinlogNetworkPacket = function BinlogNetworkPacket(packet) {
  var event;

  try {
    event = this._decoder.decode(packet.event);
  } catch (error) {
    error.fatal = true;
    this.end(error);
    return;
  }

  this.emit('event', event);
};

BinlogDump.prototype.EofPacket = function EofPacket(packet) {
  this.end(null, packet);
};

BinlogDump.prototype.stop = function stop() {
  if (this._connection && typeof this._connection.destroy === 'function') {
    this._connection.destroy();
  }

  this.end();
};

BinlogDump.prototype.stream = function stream(options) {
  var self = this;
  var streamOptions = copyStreamOptions(options);
  streamOptions.objectMode = true;

  var readable = new Readable(streamOptions);
  var paused = false;

  readable._read = function read() {
    if (paused) {
      paused = false;
      self._connection && self._connection.resume();
    }
  };

  readable._destroy = function destroy(error, callback) {
    if (!self._ended) {
      self.stop();
    }
    callback(error);
  };

  this.on('event', function onEvent(event) {
    if (!readable.push(event)) {
      paused = true;
      self._connection && self._connection.pause();
    }
  });

  this.on('error', function onError(error) {
    readable.destroy(error);
  });

  this.on('end', function onEnd() {
    if (!readable.destroyed) {
      readable.push(null);
    }
  });

  return readable;
};

function copyStreamOptions(options) {
  var copy = {};
  var source = options || {};

  for (var key in source) {
    copy[key] = source[key];
  }

  return copy;
}
