'use strict';

var TdsPacket = require('./TdsPacket');

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
  var waiters = this._waiters.splice(0);
  waiters.forEach(function (waiter) {
    if (waiter.timer) clearTimeout(waiter.timer);
    waiter.reject(this._error);
  }, this);
};

MessageIO.prototype._close = function _close() {
  this._closed = true;
  if (!this._error && (this._waiters.length || this._messageType !== null || this.parser.bufferedBytes())) {
    this._fail(new Error('SQL Server transport closed with an incomplete TDS message'));
  }
};

MessageIO.prototype.readMessage = function readMessage(timeoutMs) {
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
  this.stream.removeListener('data', this._onData);
  this.stream.removeListener('error', this._onError);
  this.stream.removeListener('close', this._onClose);
};

exports.MessageIO = MessageIO;
