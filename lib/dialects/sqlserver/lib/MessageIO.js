'use strict';

var TdsPacket = require('./TdsPacket');

function MessageReader(owner) {
  this.owner = owner;
  this.type = null;
  this._queue = [];
  this._waiters = [];
  this._ended = false;
  this._error = null;
}
MessageReader.prototype[Symbol.asyncIterator] = function iterator() { return this; };
MessageReader.prototype._push = function _push(packet) {
  if (this._ended || this._error) return;
  if (this.type === null) this.type = packet.type;
  if (packet.type !== this.type) {
    this._fail(new Error('SQL Server TDS streamed message changed packet type before EOM'));
    return;
  }
  var value = Object.freeze({ type: packet.type, payload: packet.payload, endOfMessage: packet.endOfMessage });
  var waiter = this._waiters.shift();
  if (waiter) waiter.resolve({ done: false, value: value });
  else this._queue.push(value);
  if (packet.endOfMessage) {
    this._ended = true;
    if (this.owner && this.owner._packetReader === this) this.owner._packetReader = null;
    while (this._waiters.length) this._waiters.shift().resolve({ done: true, value: undefined });
  }
};
MessageReader.prototype._fail = function _fail(error) {
  if (this._error) return;
  this._error = error instanceof Error ? error : new Error(String(error));
  if (this.owner && this.owner._packetReader === this) this.owner._packetReader = null;
  while (this._waiters.length) this._waiters.shift().reject(this._error);
};
MessageReader.prototype.next = function next() {
  if (this._queue.length) return Promise.resolve({ done: false, value: this._queue.shift() });
  if (this._error) return Promise.reject(this._error);
  if (this._ended) return Promise.resolve({ done: true, value: undefined });
  var self = this;
  return new Promise(function (resolve, reject) { self._waiters.push({ resolve: resolve, reject: reject }); });
};
MessageReader.prototype.return = function close() {
  this._ended = true;
  this._queue.length = 0;
  if (this.owner && this.owner._packetReader === this) this.owner._packetReader = null;
  while (this._waiters.length) this._waiters.shift().resolve({ done: true, value: undefined });
  return Promise.resolve({ done: true, value: undefined });
};

function MessageIO(stream, options) {
  if (!stream || typeof stream.on !== 'function' || typeof stream.write !== 'function') throw new TypeError('SQL Server MessageIO requires a duplex stream');
  options = options || {};
  this.stream = stream;
  this.packetSize = options.packetSize || TdsPacket.DEFAULT_PACKET_SIZE;
  this.parser = new TdsPacket.PacketParser();
  this._messageType = null;
  this._parts = [];
  this._messages = [];
  this._waiters = [];
  this._packetReader = null;
  this._error = null;
  this._closed = false;

  var self = this;
  this._onData = function onData(chunk) { self._accept(chunk); };
  this._onError = function onError(error) { self._fail(error); };
  this._onClose = function onClose() { self._close(); };
  stream.on('data', this._onData);
  stream.on('error', this._onError);
  stream.on('close', this._onClose);
}

MessageIO.prototype._accept = function _accept(chunk) {
  var packets;
  try { packets = this.parser.push(chunk); }
  catch (error) { this._fail(error); return; }
  for (var i = 0; i < packets.length; i++) {
    var packet = packets[i];
    if (this._packetReader) {
      this._packetReader._push(packet);
      continue;
    }
    if (this._messageType === null) this._messageType = packet.type;
    if (packet.type !== this._messageType) {
      this._fail(new Error('SQL Server TDS message changed packet type before EOM'));
      return;
    }
    this._parts.push(packet.payload);
    if (packet.endOfMessage) {
      this._deliver(Object.freeze({ type: this._messageType, payload: Buffer.concat(this._parts) }));
      this._messageType = null;
      this._parts = [];
    }
  }
};

MessageIO.prototype._deliver = function _deliver(message) {
  var waiter = this._waiters.shift();
  if (waiter) {
    if (waiter.timer) clearTimeout(waiter.timer);
    waiter.resolve(message);
  } else this._messages.push(message);
};

MessageIO.prototype._fail = function _fail(error) {
  if (this._error) return;
  this._error = error instanceof Error ? error : new Error(String(error));
  if (this._packetReader) this._packetReader._fail(this._error);
  var waiters = this._waiters.splice(0);
  waiters.forEach(function (waiter) {
    if (waiter.timer) clearTimeout(waiter.timer);
    waiter.reject(this._error);
  }, this);
};

MessageIO.prototype._close = function _close() {
  this._closed = true;
  if (this._packetReader && !this._packetReader._ended) this._packetReader._fail(new Error('SQL Server transport closed during a streamed TDS message'));
  if (!this._error && (this._waiters.length || this._messageType !== null || this.parser.bufferedBytes())) {
    this._fail(new Error('SQL Server transport closed with an incomplete TDS message'));
  }
};

MessageIO.prototype.readMessage = function readMessage(timeoutMs) {
  if (this._packetReader) return Promise.reject(new Error('SQL Server transport has a streamed message reader active'));
  if (this._messages.length) return Promise.resolve(this._messages.shift());
  if (this._error) return Promise.reject(this._error);
  if (this._closed) return Promise.reject(new Error('SQL Server transport is closed'));
  var self = this;
  return new Promise(function (resolve, reject) {
    var waiter = { resolve: resolve, reject: reject, timer: null };
    if (timeoutMs !== undefined && timeoutMs !== null) {
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return reject(new RangeError('SQL Server message timeout must be a positive number'));
      waiter.timer = setTimeout(function () {
        var index = self._waiters.indexOf(waiter);
        if (index >= 0) self._waiters.splice(index, 1);
        reject(new Error('SQL Server TDS message timed out after ' + timeoutMs + 'ms'));
      }, timeoutMs);
    }
    self._waiters.push(waiter);
  });
};

MessageIO.prototype.openMessageStream = function openMessageStream() {
  if (this._packetReader) throw new Error('SQL Server transport already has a streamed message reader');
  if (this._messages.length || this._messageType !== null || this._parts.length) throw new Error('SQL Server transport cannot stream while another response is buffered');
  if (this._error) throw this._error;
  if (this._closed) throw new Error('SQL Server transport is closed');
  this._packetReader = new MessageReader(this);
  return this._packetReader;
};

function writeChunk(stream, chunk) {
  return new Promise(function (resolve, reject) {
    var settled = false;
    function fail(error) { if (!settled) { settled = true; cleanup(); reject(error); } }
    function done() { if (!settled) { settled = true; cleanup(); resolve(); } }
    function cleanup() { stream.removeListener('error', fail); stream.removeListener('drain', done); }
    stream.once('error', fail);
    var writable;
    try { writable = stream.write(chunk); }
    catch (error) { fail(error); return; }
    if (writable !== false) done();
    else stream.once('drain', done);
  });
}

MessageIO.prototype.writeMessage = async function writeMessage(type, payload, options) {
  if (this._closed) throw new Error('SQL Server transport is closed');
  if (this._error) throw this._error;
  options = options || {};
  var packets = TdsPacket.packetize(type, payload, {
    packetSize: options.packetSize || this.packetSize,
    packetId: options.packetId,
    spid: options.spid,
    window: options.window
  });
  for (var i = 0; i < packets.length; i++) await writeChunk(this.stream, packets[i]);
};

MessageIO.prototype.setPacketSize = function setPacketSize(value) {
  if (!Number.isInteger(value) || value < 512 || value > TdsPacket.MAX_PACKET_LENGTH) throw new RangeError('SQL Server packet size must be between 512 and ' + TdsPacket.MAX_PACKET_LENGTH);
  this.packetSize = value;
};

MessageIO.prototype.detach = function detach() {
  streamReaderCleanup(this);
  this.stream.removeListener('data', this._onData);
  this.stream.removeListener('error', this._onError);
  this.stream.removeListener('close', this._onClose);
};

function streamReaderCleanup(io) {
  if (!io._packetReader) return;
  var reader = io._packetReader;
  io._packetReader = null;
  reader.owner = null;
  reader._ended = true;
  while (reader._waiters.length) reader._waiters.shift().resolve({ done: true, value: undefined });
}

exports.MessageReader = MessageReader;
exports.MessageIO = MessageIO;
