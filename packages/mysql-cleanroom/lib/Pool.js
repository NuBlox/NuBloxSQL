'use strict';

var EventEmitter = require('events').EventEmitter;
var runtime = require('./StreamingConnection');

function positiveInteger(value, fallback, name) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(name + ' must be a positive integer');
  return value;
}

function nonNegativeInteger(value, fallback, name) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 0) throw new RangeError(name + ' must be a non-negative integer');
  return value;
}

function Pool(config) {
  EventEmitter.call(this);
  config = config || {};
  this.config = Object.assign({}, config);
  this.connectionLimit = positiveInteger(config.connectionLimit, 10, 'connectionLimit');
  this.maxIdle = positiveInteger(config.maxIdle, this.connectionLimit, 'maxIdle');
  if (this.maxIdle > this.connectionLimit) this.maxIdle = this.connectionLimit;
  this.idleTimeout = nonNegativeInteger(config.idleTimeout, 60000, 'idleTimeout');
  this.acquireTimeout = positiveInteger(config.acquireTimeout, 10000, 'acquireTimeout');
  this.queueLimit = nonNegativeInteger(config.queueLimit, 0, 'queueLimit');
  this.resetOnRelease = config.resetOnRelease !== false;
  this._all = new Set();
  this._idle = [];
  this._waiters = [];
  this._resetting = new Set();
  this._ended = false;
  this._maintenance = null;
  if (this.idleTimeout > 0) {
    var self = this;
    this._maintenance = setInterval(function () { self._evictIdle(); }, Math.max(1000, Math.min(this.idleTimeout, 30000)));
    if (this._maintenance.unref) this._maintenance.unref();
  }
}
Pool.prototype = Object.create(EventEmitter.prototype);
Pool.prototype.constructor = Pool;

Pool.prototype._connectionConfig = function _connectionConfig() {
  var config = Object.assign({}, this.config);
  delete config.connectionLimit;
  delete config.maxIdle;
  delete config.idleTimeout;
  delete config.acquireTimeout;
  delete config.queueLimit;
  delete config.resetOnRelease;
  return config;
};

Pool.prototype._remove = function _remove(connection) {
  this._all.delete(connection);
  this._resetting.delete(connection);
  for (var i = this._idle.length - 1; i >= 0; i--) if (this._idle[i].connection === connection) this._idle.splice(i, 1);
};

Pool.prototype._create = async function _create() {
  var self = this;
  var connection = new runtime.Connection(this._connectionConfig());
  this._all.add(connection);
  connection.once('close', function () {
    self._remove(connection);
    self._drain();
  });
  try {
    await connection.connect();
    this.emit('connection', connection);
    return connection;
  } catch (error) {
    this._remove(connection);
    throw error;
  }
};

Pool.prototype._takeIdle = function _takeIdle() {
  while (this._idle.length) {
    var entry = this._idle.shift();
    var connection = entry.connection;
    if (connection.connected && !connection.ended && !connection._queryState && !connection.inTransaction && !this._resetting.has(connection)) return connection;
    this._remove(connection);
    if (!connection.ended) connection.destroy();
  }
  return null;
};

Pool.prototype._settleWaiter = function _settleWaiter(waiter, connection, error) {
  if (waiter.settled) return;
  waiter.settled = true;
  if (waiter.timer) clearTimeout(waiter.timer);
  if (waiter.signal && waiter.abortHandler) waiter.signal.removeEventListener('abort', waiter.abortHandler);
  if (error) waiter.reject(error);
  else waiter.resolve(connection);
};

Pool.prototype._makeAvailable = function _makeAvailable(connection) {
  if (this._ended || connection.ended || !connection.connected) {
    this._remove(connection);
    if (!connection.ended) connection.destroy();
    this._drain();
    return;
  }

  while (this._waiters.length) {
    var waiter = this._waiters.shift();
    if (waiter.settled) continue;
    this.emit('acquire', connection);
    this._settleWaiter(waiter, connection);
    return;
  }

  this._idle.push({ connection: connection, since: Date.now() });
  this.emit('release', connection);
  while (this._idle.length > this.maxIdle) {
    var excess = this._idle.shift().connection;
    this._remove(excess);
    excess.end();
  }
};

Pool.prototype._sanitizeAndMakeAvailable = function _sanitizeAndMakeAvailable(connection) {
  var self = this;
  if (!this.resetOnRelease) {
    this._makeAvailable(connection);
    return;
  }
  this._resetting.add(connection);
  connection.resetSession().then(function () {
    self._resetting.delete(connection);
    self.emit('reset', connection);
    self._makeAvailable(connection);
    self._drain();
  }, function (error) {
    self._resetting.delete(connection);
    self._remove(connection);
    connection.destroy(error);
    if (self.listenerCount('resetError') > 0) self.emit('resetError', error, connection);
    self._drain();
  });
};

Pool.prototype._drain = function _drain() {
  if (this._ended) return;
  while (this._waiters.length) {
    var waiter = this._waiters[0];
    if (waiter.settled) {
      this._waiters.shift();
      continue;
    }
    var idle = this._takeIdle();
    if (idle) {
      this._waiters.shift();
      this.emit('acquire', idle);
      this._settleWaiter(waiter, idle);
      continue;
    }
    if (this._all.size < this.connectionLimit) {
      this._waiters.shift();
      var self = this;
      (function (pending) {
        self._create().then(function (connection) {
          self.emit('acquire', connection);
          self._settleWaiter(pending, connection);
          self._drain();
        }, function (error) {
          self._settleWaiter(pending, null, error);
          self._drain();
        });
      })(waiter);
    }
    break;
  }
};

Pool.prototype.getConnection = function getConnection(options) {
  options = options || {};
  if (this._ended) return Promise.reject(new Error('MySQL pool has ended'));
  if (options.signal && options.signal.aborted) return Promise.reject(options.signal.reason || new Error('MySQL pool acquisition aborted'));

  var idle = this._takeIdle();
  if (idle) {
    this.emit('acquire', idle);
    return Promise.resolve(idle);
  }
  if (this._all.size < this.connectionLimit) {
    var self = this;
    return this._create().then(function (connection) { self.emit('acquire', connection); return connection; });
  }
  if (this.queueLimit && this._waiters.length >= this.queueLimit) return Promise.reject(new Error('MySQL pool acquisition queue limit reached'));

  var timeout = options.timeout === undefined ? this.acquireTimeout : options.timeout;
  if (!Number.isFinite(timeout) || timeout <= 0) return Promise.reject(new RangeError('MySQL pool acquisition timeout must be a positive number'));
  var waiter = { settled: false, signal: options.signal || null, abortHandler: null, timer: null };
  waiter.promise = new Promise(function (resolve, reject) { waiter.resolve = resolve; waiter.reject = reject; });
  self = this;
  waiter.timer = setTimeout(function () {
    var index = self._waiters.indexOf(waiter);
    if (index !== -1) self._waiters.splice(index, 1);
    self._settleWaiter(waiter, null, new Error('MySQL pool acquisition timed out'));
  }, timeout);
  if (waiter.timer.unref) waiter.timer.unref();
  if (waiter.signal) {
    waiter.abortHandler = function () {
      var index = self._waiters.indexOf(waiter);
      if (index !== -1) self._waiters.splice(index, 1);
      self._settleWaiter(waiter, null, waiter.signal.reason || new Error('MySQL pool acquisition aborted'));
    };
    waiter.signal.addEventListener('abort', waiter.abortHandler, { once: true });
  }
  this._waiters.push(waiter);
  return waiter.promise;
};

Pool.prototype.releaseConnection = function releaseConnection(connection) {
  if (!this._all.has(connection)) throw new Error('Cannot release a connection that does not belong to this pool');
  if (this._resetting.has(connection)) throw new Error('Cannot release a MySQL connection while it is being reset');
  if (connection._queryState) throw new Error('Cannot release a MySQL connection with an active operation');
  if (connection.inTransaction) throw new Error('Cannot release a MySQL connection with an active transaction');
  if (connection.ended || !connection.connected || this._ended) {
    this._remove(connection);
    if (!connection.ended) connection.destroy();
    this._drain();
    return;
  }
  this._sanitizeAndMakeAvailable(connection);
};

Pool.prototype._evictIdle = function _evictIdle() {
  if (!this.idleTimeout || this._ended) return;
  var now = Date.now();
  for (var i = this._idle.length - 1; i >= 0; i--) {
    var entry = this._idle[i];
    if (now - entry.since < this.idleTimeout) continue;
    this._idle.splice(i, 1);
    this._all.delete(entry.connection);
    entry.connection.end();
    this.emit('evict', entry.connection);
  }
  this._drain();
};

Pool.prototype.query = async function query(sql, options) {
  var connection = await this.getConnection(options && options.acquire);
  try { return await connection.query(sql, options || {}); }
  finally { if (this._all.has(connection)) this.releaseConnection(connection); }
};

Pool.prototype.queryStream = async function queryStream(sql, options) {
  var self = this;
  var connection = await this.getConnection(options && options.acquire);
  var stream;
  try {
    stream = connection.queryStream(sql, options || {});
  } catch (error) {
    if (this._all.has(connection) && !connection.ended && !connection.inTransaction && !connection._queryState) this.releaseConnection(connection);
    throw error;
  }

  var settled = false;
  function releaseWhenSafe() {
    if (settled) return;
    if (connection._queryState) return;
    settled = true;
    if (self._all.has(connection) && !connection.ended && !connection.inTransaction) self.releaseConnection(connection);
  }
  stream.once('end', releaseWhenSafe);
  stream.once('close', releaseWhenSafe);
  return stream;
};

Pool.prototype.execute = async function execute(sql, params, options) {
  var connection = await this.getConnection(options && options.acquire);
  var statement = null;
  try {
    statement = await connection.prepare(sql, options || {});
    return await statement.execute(params || [], options || {});
  } finally {
    if (statement && !statement.closed && connection.connected && !connection.ended) {
      try { await statement.close(); } catch (error) { connection.destroy(error); }
    }
    if (this._all.has(connection) && !connection.ended && !connection.inTransaction) this.releaseConnection(connection);
  }
};

Pool.prototype.withTransaction = async function withTransaction(fn, options) {
  var connection = await this.getConnection(options && options.acquire);
  try { return await connection.withTransaction(fn, options || {}); }
  finally {
    if (connection.inTransaction) {
      try { await connection.rollback(); } catch (error) { connection.destroy(error); }
    }
    if (this._all.has(connection) && !connection.ended) this.releaseConnection(connection);
  }
};

Pool.prototype.end = async function end() {
  if (this._ended) return;
  this._ended = true;
  if (this._maintenance) clearInterval(this._maintenance);
  var error = new Error('MySQL pool has ended');
  while (this._waiters.length) this._settleWaiter(this._waiters.shift(), null, error);
  var resetting = this._resetting;
  var connections = Array.from(this._all);
  this._idle.length = 0;
  this._all.clear();
  this._resetting = new Set();
  await Promise.all(connections.map(function (connection) {
    if (resetting.has(connection)) {
      connection.destroy();
      return Promise.resolve();
    }
    return connection.end();
  }));
};

Object.defineProperties(Pool.prototype, {
  totalCount: { get: function () { return this._all.size; } },
  idleCount: { get: function () { return this._idle.length; } },
  waitingCount: { get: function () { return this._waiters.filter(function (waiter) { return !waiter.settled; }).length; } },
  resettingCount: { get: function () { return this._resetting.size; } }
});

exports.Pool = Pool;
