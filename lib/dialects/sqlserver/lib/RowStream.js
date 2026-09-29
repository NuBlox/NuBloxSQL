'use strict';

var TdsPacket = require('./TdsPacket');
var IncrementalResultStream = require('./IncrementalResultStream').IncrementalResultStream;

function positiveTimeout(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(name + ' must be a positive number');
  return Number(value);
}

function withTimeout(promise, timeout, ErrorType, message, code) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new ErrorType(message, { code: code })); }, timeout);
    if (timer.unref) timer.unref();
    Promise.resolve(promise).then(function (value) { clearTimeout(timer); resolve(value); }, function (error) { clearTimeout(timer); reject(error); });
  });
}

function RowStream(connection, packetType, payload, options, helpers) {
  this.connection = connection;
  this.packetType = packetType;
  this.payload = payload;
  this.options = options || {};
  this.SqlServerError = helpers.SqlServerError;
  this.controlError = helpers.controlError;
  this.parser = new IncrementalResultStream();
  this.fields = null;
  this.closed = false;
  this.done = false;
  this.result = null;
  this._reader = null;
  this._rows = [];
  this._initialized = false;
  this._initializing = null;
  this._controlPromise = null;
  this._timer = null;
  this._abortHandler = null;
  this._controlResolve = null;
}
RowStream.prototype[Symbol.asyncIterator] = function iterator() { return this; };

RowStream.prototype._initialize = function _initialize() {
  if (this._initialized) return Promise.resolve();
  if (this._initializing) return this._initializing;
  var self = this;
  this._initializing = this._start().then(function () {
    self._initialized = true;
    self._initializing = null;
  }, function (error) {
    self._initializing = null;
    throw error;
  });
  return this._initializing;
};

RowStream.prototype._start = async function _start() {
  var connection = this.connection;
  if (!connection.connected || !connection.io) throw new this.SqlServerError('SQL Server connection is not connected');
  if (connection._busy) throw new this.SqlServerError('SQL Server connection already has an operation in flight', { code: 'NUBLOX_SQLSERVER_BUSY' });

  var timeout = this.options.timeout === undefined ? (connection.config.queryTimeout === undefined ? 30000 : connection.config.queryTimeout) : this.options.timeout;
  timeout = positiveTimeout(timeout, 'SQL Server stream timeout');
  if (this.options.deadline !== undefined) {
    if (!Number.isFinite(this.options.deadline)) throw new RangeError('SQL Server stream deadline must be a finite epoch millisecond value');
    timeout = Math.min(timeout, this.options.deadline - Date.now());
    if (timeout <= 0) throw this.controlError('timeout');
  }
  var signal = this.options.signal;
  if (signal !== undefined && (!signal || typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function')) throw new TypeError('SQL Server stream signal must be an AbortSignal');
  if (signal && signal.aborted) throw this.controlError('cancelled', signal.reason instanceof Error ? signal.reason : null);

  connection._busy = true;
  try {
    this._reader = connection.io.openMessageStream({ highWaterMark: this.options.highWaterMark });
    await connection.io.writeMessage(this.packetType, this.payload);
  } catch (error) {
    if (this._reader) await this._reader.return();
    connection._busy = false;
    throw error;
  }

  var self = this;
  this._controlPromise = new Promise(function (resolve) {
    self._controlResolve = resolve;
    self._timer = setTimeout(function () { resolve({ kind: 'timeout', cause: null }); }, timeout);
    if (self._timer.unref) self._timer.unref();
    if (signal) {
      self._abortHandler = function () { resolve({ kind: 'cancelled', cause: signal.reason instanceof Error ? signal.reason : null }); };
      signal.addEventListener('abort', self._abortHandler, { once: true });
    }
  });
};

RowStream.prototype._clearControl = function _clearControl() {
  if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  var signal = this.options.signal;
  if (signal && this._abortHandler) signal.removeEventListener('abort', this._abortHandler);
  this._abortHandler = null;
  this._controlResolve = null;
};

RowStream.prototype._finish = function _finish() {
  if (this.done) return;
  this.done = true;
  this.result = this.parser.result();
  this.fields = this.result.columns;
  this.connection._applyEnvChanges(this.result);
  this._clearControl();
  this.connection._busy = false;
};

RowStream.prototype._nativeError = function _nativeError() {
  var result = this.parser.result();
  var nativeError = result.errors[0] || null;
  return new this.SqlServerError(nativeError ? nativeError.message : 'SQL Server streaming query failed', {
    code: nativeError ? nativeError.number : null,
    severity: nativeError ? nativeError.severity : null,
    state: nativeError ? nativeError.state : null,
    native: nativeError,
    result: result
  });
};

RowStream.prototype._drainAfterAttention = async function _drainAfterAttention() {
  if (!this._reader) return;
  if (this._reader._ended) { await this._reader.return(); return; }
  var cancelTimeout = positiveTimeout(this.options.cancelTimeout === undefined ? (this.connection.config.cancelTimeout === undefined ? 5000 : this.connection.config.cancelTimeout) : this.options.cancelTimeout, 'SQL Server cancellation timeout');
  await this.connection.io.writeMessage(TdsPacket.PACKET_TYPES.ATTENTION, Buffer.alloc(0));
  while (true) {
    var item = await withTimeout(this._reader.next(), cancelTimeout, this.SqlServerError, 'SQL Server ATTENTION acknowledgement timed out', 'NUBLOX_SQLSERVER_ATTENTION_TIMEOUT');
    if (item.done) break;
    this.parser.push(item.value.payload, item.value.endOfMessage);
    if (item.value.endOfMessage) break;
  }
  await this._reader.return();
};

RowStream.prototype._cancel = async function _cancel(kind, cause, silent) {
  if (this.done || this.closed) return;
  try {
    await this._drainAfterAttention();
    this._finish();
  } catch (error) {
    this.connection._destroy();
    this._clearControl();
    this.closed = true;
    throw new this.SqlServerError('SQL Server could not safely resynchronize after streaming cancellation', {
      code: 'NUBLOX_SQLSERVER_CANCEL_SYNC', cause: error, native: error
    });
  }
  this.closed = true;
  if (!silent) throw this.controlError(kind, cause);
};

RowStream.prototype.next = async function next() {
  if (this.closed) return { done: true, value: undefined };
  await this._initialize();
  if (this._rows.length) return { done: false, value: this._rows.shift() };
  if (this.done) {
    if (this.result && !this.result.success) { this.closed = true; throw this._nativeError(); }
    this.closed = true;
    return { done: true, value: undefined };
  }

  while (!this._rows.length && !this.done) {
    var outcome = await Promise.race([
      this._reader.next().then(function (item) { return { item: item }; }),
      this._controlPromise
    ]);
    if (outcome.kind) return this._cancel(outcome.kind, outcome.cause, false);
    if (outcome.item.done) {
      if (!this.parser.ended) throw new this.SqlServerError('SQL Server streamed response ended before TDS end-of-message', { code: 'NUBLOX_SQLSERVER_STREAM_INCOMPLETE' });
      this._finish();
      break;
    }
    var packet = outcome.item.value;
    if (packet.type !== TdsPacket.PACKET_TYPES.RESPONSE) throw new this.SqlServerError('SQL Server returned unexpected streaming response packet type', { packetType: packet.type });
    var rows = this.parser.push(packet.payload, packet.endOfMessage);
    for (var i = 0; i < rows.length; i++) this._rows.push(rows[i]);
    this.fields = this.parser.columns;
    if (packet.endOfMessage) this._finish();
  }

  if (this._rows.length) return { done: false, value: this._rows.shift() };
  if (this.result && !this.result.success) { this.closed = true; throw this._nativeError(); }
  this.closed = true;
  return { done: true, value: undefined };
};

RowStream.prototype.return = async function closeEarly() {
  await this.close();
  return { done: true, value: undefined };
};

RowStream.prototype.close = async function close() {
  if (this.closed) return;
  if (!this._initialized && !this._initializing) { this.closed = true; return; }
  await this._initialize();
  if (!this.done) await this._cancel('cancelled', null, true);
  if (this._reader) await this._reader.return();
  this.closed = true;
};

exports.RowStream = RowStream;
