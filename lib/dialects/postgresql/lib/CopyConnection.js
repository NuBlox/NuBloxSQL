'use strict';

var EventEmitter = require('events').EventEmitter;
var portal = require('./PortalConnection');
var frontend = require('./protocol/FrontendMessage');

var DEFAULT_COPY_BUFFER_BYTES = 64 * 1024 * 1024;

function normalizeMaxBytes(value, fallback) {
  if (value === undefined) return fallback;
  if (value === Infinity) return Infinity;
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('PostgreSQL COPY maxBytes must be a positive safe integer or Infinity');
  return value;
}

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  throw new TypeError('PostgreSQL COPY chunks must be string, Buffer, or Uint8Array');
}

function singleValueIterator(value) {
  var done = false;
  return {
    next: async function next() {
      if (done) return { done: true, value: undefined };
      done = true;
      return { done: false, value: value };
    },
    return: async function close() { done = true; return { done: true, value: undefined }; }
  };
}

function sourceIterator(source) {
  if (typeof source === 'string' || Buffer.isBuffer(source) || source instanceof Uint8Array) return singleValueIterator(source);
  if (source && typeof source[Symbol.asyncIterator] === 'function') return source[Symbol.asyncIterator]();
  if (source && typeof source[Symbol.iterator] === 'function') {
    var iterator = source[Symbol.iterator]();
    return {
      next: async function next() { return iterator.next(); },
      return: async function close() {
        if (typeof iterator.return === 'function') return iterator.return();
        return { done: true, value: undefined };
      }
    };
  }
  throw new TypeError('PostgreSQL copyFrom source must be bytes, string, Iterable, or AsyncIterable');
}

function waitForDrain(socket) {
  return new Promise(function (resolve, reject) {
    function cleanup() {
      socket.removeListener('drain', onDrain);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
    }
    function onDrain() { cleanup(); resolve(); }
    function onError(error) { cleanup(); reject(error); }
    function onClose() { cleanup(); reject(new Error('PostgreSQL connection closed during COPY')); }
    socket.once('drain', onDrain);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}

async function writeFrame(connection, frame) {
  if (!connection.socket || connection.ended) throw new Error('PostgreSQL connection is not ready for COPY');
  if (!connection.socket.write(frame)) await waitForDrain(connection.socket);
}

function formatName(code) { return code === 1 ? 'binary' : 'text'; }

function copyResult(state, baseResult) {
  var result = {
    direction: state.copyMode === 'in' ? 'from' : 'to',
    format: formatName(state.copyFormat),
    columnFormats: Object.freeze((state.copyColumnFormats || []).map(formatName)),
    bytes: state.bytes,
    command: baseResult.command || '',
    rowCount: baseResult.rowCount
  };
  if (state.copyMode === 'out' && !state.sink) result.data = Buffer.concat(state.chunks, state.bytes);
  return Object.freeze(result);
}

function sinkWrite(sink, chunk) {
  if (typeof sink === 'function') return Promise.resolve(sink(chunk));
  if (!sink || typeof sink.write !== 'function') return Promise.reject(new TypeError('PostgreSQL copyTo sink must be a function or writable object'));
  var accepted;
  try { accepted = sink.write(chunk); }
  catch (error) { return Promise.reject(error); }
  if (accepted !== false) return Promise.resolve();
  if (typeof sink.once !== 'function' || typeof sink.removeListener !== 'function') return Promise.reject(new Error('PostgreSQL COPY sink returned false but cannot signal drain'));
  return new Promise(function (resolve, reject) {
    function cleanup() {
      sink.removeListener('drain', onDrain);
      sink.removeListener('error', onError);
      sink.removeListener('close', onClose);
    }
    function onDrain() { cleanup(); resolve(); }
    function onError(error) { cleanup(); reject(error); }
    function onClose() { cleanup(); reject(new Error('PostgreSQL COPY sink closed before drain')); }
    sink.once('drain', onDrain);
    sink.once('error', onError);
    sink.once('close', onClose);
  });
}

function Connection(config) {
  portal.Connection.call(this, config);
  config = config || {};
  this.maxCopyBufferBytes = normalizeMaxBytes(config.maxCopyBufferBytes, DEFAULT_COPY_BUFFER_BYTES);
}
Connection.prototype = Object.create(portal.Connection.prototype);
Connection.prototype.constructor = Connection;

Connection.prototype._pumpCopyIn = async function _pumpCopyIn(state) {
  try {
    while (true) {
      if (this._currentQuery !== state) throw state.cancelReason || new Error('PostgreSQL COPY operation is no longer active');
      var item = await state.iterator.next();
      if (item.done) break;
      var chunk = toBuffer(item.value);
      state.bytes += chunk.length;
      if (state.bytes > state.maxBytes) throw new RangeError('PostgreSQL COPY input exceeded maxBytes (' + state.maxBytes + ')');
      await writeFrame(this, frontend.encodeCopyData(chunk));
    }
    if (this._currentQuery === state) await writeFrame(this, frontend.encodeCopyDone());
  } catch (error) {
    state.sourceError = error;
    if (this._currentQuery === state && this.socket && !this.ended) {
      try { await writeFrame(this, frontend.encodeCopyFail(error.message || 'NuBloxSQL COPY input failed')); }
      catch (writeError) {
        if (error.cause === undefined) error.cause = writeError;
        this.destroy(error);
      }
    }
  }
};

Connection.prototype._queueCopyOut = function _queueCopyOut(state, data) {
  var chunk = Buffer.from(data);
  state.bytes += chunk.length;
  if (state.bytes > state.maxBytes) {
    var limitError = new RangeError('PostgreSQL COPY output exceeded maxBytes (' + state.maxBytes + ')');
    state.sinkError = limitError;
    // COPY OUT cannot be failed with a frontend CopyFail message. An auxiliary
    // CancelRequest identifies the backend session rather than this operation,
    // so it can race with subsequent pooled work after the server has naturally
    // completed COPY. Fail closed by retiring the connection immediately.
    this.destroy(limitError);
    return;
  }
  if (!state.sink) {
    state.chunks.push(chunk);
    return;
  }

  var self = this;
  state.pendingSink += 1;
  if (this.socket && typeof this.socket.pause === 'function') this.socket.pause();
  state.sinkPromise = state.sinkPromise.then(function () {
    return sinkWrite(state.sink, chunk);
  }).catch(function (error) {
    state.sinkError = state.sinkError || error;
    // A failed consumer cannot safely drain the current COPY OUT stream. Retire
    // the session instead of dispatching a CancelRequest that may arrive late.
    if (!self.ended) self.destroy(state.sinkError);
  }).finally(function () {
    state.pendingSink -= 1;
    if (state.pendingSink === 0 && self.socket && !self.ended && typeof self.socket.resume === 'function') self.socket.resume();
  });
};

var parentHandleMessage = portal.Connection.prototype._handleMessage;
Connection.prototype._handleMessage = function _handleMessage(message) {
  var state = this._currentQuery;
  if (!state || !state.copyMode) return parentHandleMessage.call(this, message);

  if (message.type === 'copyInResponse') {
    if (state.copyMode !== 'in') {
      state.error = new Error('PostgreSQL copyTo received COPY FROM STDIN response');
      try { this.socket.write(frontend.encodeCopyFail(state.error.message)); } catch (_) {}
      return;
    }
    state.copyStarted = true;
    state.copyFormat = message.format;
    state.copyColumnFormats = message.columnFormats;
    if (!state.sourcePromise) state.sourcePromise = this._pumpCopyIn(state);
    return;
  }

  if (message.type === 'copyOutResponse') {
    if (state.copyMode !== 'out') {
      state.error = new Error('PostgreSQL copyFrom received COPY TO STDOUT response');
      // COPY OUT has no frontend CopyFail equivalent. A separate CancelRequest can
      // race with a later pooled operation on older PostgreSQL releases, so fail
      // closed and retire this connection instead of allowing unsafe reuse.
      this.destroy(state.error);
      return;
    }
    state.copyStarted = true;
    state.copyFormat = message.format;
    state.copyColumnFormats = message.columnFormats;
    return;
  }

  if (message.type === 'copyBothResponse') {
    state.error = new Error('PostgreSQL COPY BOTH is not supported by copyFrom/copyTo; use a replication-specific API');
    this.destroy(state.error);
    return;
  }

  if (message.type === 'copyData') {
    if (state.cancelReason || state.error) return;
    if (state.copyMode !== 'out' || !state.copyStarted) {
      state.error = new Error('Unexpected PostgreSQL CopyData message');
      this.destroy(state.error);
      return;
    }
    this._queueCopyOut(state, message.data);
    return;
  }

  if (message.type === 'copyDone') {
    state.copyDone = true;
    return;
  }

  return parentHandleMessage.call(this, message);
};

Connection.prototype.copyFrom = function copyFrom(sql, source, options) {
  options = options || {};
  var iterator;
  try { iterator = sourceIterator(source); }
  catch (error) { return Promise.reject(error); }
  var state = {
    kind: 'simple', copyMode: 'in', copyStarted: false, copyDone: false,
    copyFormat: 0, copyColumnFormats: [], iterator: iterator,
    sourcePromise: null, sourceError: null, bytes: 0,
    maxBytes: normalizeMaxBytes(options.maxBytes, Infinity),
    rows: [], fields: [], command: '', rowCount: null, error: null
  };
  var operation;
  try { operation = this._startOperation(state, [frontend.encodeQuery(sql)], options); }
  catch (error) { operation = Promise.reject(error); }
  return operation.then(async function (baseResult) {
    if (state.sourcePromise) await state.sourcePromise;
    if (state.sourceError) throw state.sourceError;
    if (!state.copyStarted) throw new Error('PostgreSQL copyFrom query did not enter COPY FROM STDIN mode');
    return copyResult(state, baseResult);
  }, async function (error) {
    if (state.sourcePromise) await state.sourcePromise;
    if (state.sourceError) {
      if (state.sourceError !== error && state.sourceError.cause === undefined) state.sourceError.cause = error;
      throw state.sourceError;
    }
    throw error;
  }).finally(async function () {
    if (iterator && typeof iterator.return === 'function') {
      try { await iterator.return(); } catch (_) {}
    }
  });
};

Connection.prototype.copyTo = function copyTo(sql, options) {
  options = options || {};
  var sink = options.sink;
  var fallbackMax = sink ? Infinity : this.maxCopyBufferBytes;
  var state = {
    kind: 'simple', copyMode: 'out', copyStarted: false, copyDone: false,
    copyFormat: 0, copyColumnFormats: [], sink: sink || null,
    sinkPromise: Promise.resolve(), sinkError: null, pendingSink: 0,
    chunks: [], bytes: 0, maxBytes: normalizeMaxBytes(options.maxBytes, fallbackMax),
    rows: [], fields: [], command: '', rowCount: null, error: null
  };
  var operation;
  try { operation = this._startOperation(state, [frontend.encodeQuery(sql)], options); }
  catch (error) { operation = Promise.reject(error); }
  return operation.then(async function (baseResult) {
    await state.sinkPromise;
    if (state.sinkError) throw state.sinkError;
    if (!state.copyStarted) throw new Error('PostgreSQL copyTo query did not enter COPY TO STDOUT mode');
    return copyResult(state, baseResult);
  }, async function (error) {
    await state.sinkPromise;
    if (state.sinkError) {
      if (state.sinkError !== error && state.sinkError.cause === undefined) state.sinkError.cause = error;
      throw state.sinkError;
    }
    throw error;
  });
};

exports.Connection = Connection;
exports.PreparedStatement = portal.PreparedStatement;
exports.PortalCursor = portal.PortalCursor;
exports.PostgreSqlError = portal.PostgreSqlError;
exports.PostgreSqlCancellationError = portal.PostgreSqlCancellationError;
exports.PostgreSqlResultLimitError = portal.PostgreSqlResultLimitError;
exports.DEFAULT_RESULT_LIMITS = portal.DEFAULT_RESULT_LIMITS;
exports.DEFAULT_COPY_BUFFER_BYTES = DEFAULT_COPY_BUFFER_BYTES;
exports.TYPE_OIDS = portal.TYPE_OIDS;
exports.ISOLATION_LEVELS = portal.ISOLATION_LEVELS;
exports.quoteIdentifier = portal.quoteIdentifier;
