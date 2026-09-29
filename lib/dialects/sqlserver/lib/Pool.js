'use strict';

var EventEmitter = require('events').EventEmitter;
var Connection = require('./Connection').Connection;

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
  if (!config.user) throw new TypeError('SQL Server pool requires user');
  this.config = Object.assign({}, config);
  this.connectionLimit = positiveInteger(config.connectionLimit, 10, 'SQL Server connectionLimit');
  this.maxIdle = positiveInteger(config.maxIdle, this.connectionLimit, 'SQL Server maxIdle');
  if (this.maxIdle > this.connectionLimit) this.maxIdle = this.connectionLimit;
  this.idleTimeout = nonNegativeInteger(config.idleTimeout, 60000, 'SQL Server idleTimeout');
  this.acquireTimeout = positiveInteger(config.acquireTimeout, 10000, 'SQL Server acquireTimeout');
  this.queueLimit = nonNegativeInteger(config.queueLimit, 0, 'SQL Server queueLimit');
  this._all = new Set();
  this._borrowed = new Set();
  this._idle = [];
  this._waiters = [];
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
  ['connectionLimit','maxIdle','idleTimeout','acquireTimeout','queueLimit'].forEach(function (key) { delete config[key]; });
  return config;
};
Pool.prototype._remove = function _remove(connection) {
  this._all.delete(connection);
  this._borrowed.delete(connection);
  for (var i = this._idle.length - 1; i >= 0; i--) if (this._idle[i].connection === connection) this._idle.splice(i, 1);
};
Pool.prototype._create = async function _create() {
  var connection = new Connection(this._connectionConfig());
  this._all.add(connection);
  try {
    await connection.connect();
    this.emit('connection', connection);
    return connection;
  } catch (error) {
    this._remove(connection);
    try { await connection.end(); } catch (_) {}
    throw error;
  }
};
Pool.prototype._takeIdle = function _takeIdle() {
  while (this._idle.length) {
    var entry = this._idle.shift();
    var connection = entry.connection;
    if (connection.connected && !connection.ended && !connection._busy && connection.transactionDescriptor === 0n) return connection;
    this._remove(connection);
    if (!connection.ended) connection.end();
  }
  return null;
};
Pool.prototype._settleWaiter = function _settleWaiter(waiter, connection, error) {
  if (waiter.settled) return;
  waiter.settled = true;
  if (waiter.timer) clearTimeout(waiter.timer);
  if (waiter.signal && waiter.abortHandler) waiter.signal.removeEventListener('abort', waiter.abortHandler);
  if (error) waiter.reject(error);
  else {
    this._borrowed.add(connection);
    this.emit('acquire', connection);
    waiter.resolve(connection);
  }
};
Pool.prototype._makeAvailable = function _makeAvailable(connection) {
  if (this._ended || connection.ended || !connection.connected) {
    this._remove(connection);
    if (!connection.ended) connection.end();
    this._drain();
    return;
  }
  while (this._waiters.length) {
    var waiter = this._waiters.shift();
    if (waiter.settled) continue;
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
Pool.prototype._drain = function _drain() {
  var self = this;
  if (this._ended) return;
  while (this._waiters.length) {
    var waiter = this._waiters[0];
    if (waiter.settled) { this._waiters.shift(); continue; }
    var idle = this._takeIdle();
    if (idle) { this._waiters.shift(); this._settleWaiter(waiter, idle); continue; }
    if (this._all.size < this.connectionLimit) {
      this._waiters.shift();
      (function (pending) {
        self._create().then(function (connection) { self._settleWaiter(pending, connection); self._drain(); }, function (error) { self._settleWaiter(pending, null, error); self._drain(); });
      })(waiter);
    }
    break;
  }
};
Pool.prototype.getConnection = function getConnection(options) {
  options = options || {};
  if (this._ended) return Promise.reject(new Error('SQL Server pool has ended'));
  if (options.signal && options.signal.aborted) return Promise.reject(options.signal.reason || new Error('SQL Server pool acquisition aborted'));
  var idle = this._takeIdle();
  if (idle) { this._borrowed.add(idle); this.emit('acquire', idle); return Promise.resolve(idle); }
  var self = this;
  if (this._all.size < this.connectionLimit) return this._create().then(function (connection) { self._borrowed.add(connection); self.emit('acquire', connection); return connection; });
  if (this.queueLimit && this._waiters.length >= this.queueLimit) return Promise.reject(new Error('SQL Server pool acquisition queue limit reached'));
  var timeout = options.timeout === undefined ? this.acquireTimeout : options.timeout;
  if (options.deadline !== undefined) timeout = Math.min(timeout, options.deadline - Date.now());
  if (!Number.isFinite(timeout) || timeout <= 0) return Promise.reject(new Error('SQL Server pool acquisition timed out'));
  var waiter = { settled:false, signal:options.signal||null, abortHandler:null, timer:null };
  waiter.promise = new Promise(function (resolve, reject) { waiter.resolve=resolve; waiter.reject=reject; });
  waiter.timer = setTimeout(function () {
    var index=self._waiters.indexOf(waiter); if(index!==-1)self._waiters.splice(index,1);
    self._settleWaiter(waiter,null,new Error('SQL Server pool acquisition timed out'));
  }, timeout);
  if (waiter.timer.unref) waiter.timer.unref();
  if (waiter.signal) {
    waiter.abortHandler=function(){var index=self._waiters.indexOf(waiter);if(index!==-1)self._waiters.splice(index,1);self._settleWaiter(waiter,null,waiter.signal.reason||new Error('SQL Server pool acquisition aborted'));};
    waiter.signal.addEventListener('abort',waiter.abortHandler,{once:true});
  }
  this._waiters.push(waiter);
  return waiter.promise;
};
Pool.prototype.releaseConnection = async function releaseConnection(connection) {
  if (!this._all.has(connection)) throw new Error('Cannot release a connection that does not belong to this SQL Server pool');
  if (!this._borrowed.has(connection)) throw new Error('Cannot release a SQL Server connection that is not currently borrowed');
  if (connection._busy) throw new Error('Cannot release a SQL Server connection with an active operation');
  this._borrowed.delete(connection);
  if (connection.transactionDescriptor !== 0n) {
    try { await connection.rollback(); }
    catch (error) { this._remove(connection); await connection.end(); this._drain(); throw error; }
  }
  this._makeAvailable(connection);
  this._drain();
};
Pool.prototype.query = async function query(sql, options) {
  options=options||{};var connection=await this.getConnection(options.acquire);
  try{return await connection.query(sql,options);}finally{if(this._borrowed.has(connection))await this.releaseConnection(connection);}
};
Pool.prototype.execute = async function execute(sql, parameters, options) {
  options=options||{};var connection=await this.getConnection(options.acquire);
  try{return await connection.execute(sql,parameters||[],options);}finally{if(this._borrowed.has(connection))await this.releaseConnection(connection);}
};
Pool.prototype.withTransaction = async function withTransaction(fn, options) {
  options=options||{};var connection=await this.getConnection(options.acquire);
  try{return await connection.withTransaction(fn,options);}finally{
    if(connection.connected&&!connection.ended&&connection.transactionDescriptor!==0n){try{await connection.rollback();}catch(error){await connection.end();}}
    if(this._borrowed.has(connection))await this.releaseConnection(connection);
  }
};
Pool.prototype._evictIdle = function _evictIdle() {
  if(!this.idleTimeout||this._ended)return;var now=Date.now();
  for(var i=this._idle.length-1;i>=0;i--){var entry=this._idle[i];if(now-entry.since<this.idleTimeout)continue;this._idle.splice(i,1);this._all.delete(entry.connection);entry.connection.end();this.emit('evict',entry.connection);}this._drain();
};
Pool.prototype.end = async function end() {
  if(this._ended)return;this._ended=true;if(this._maintenance)clearInterval(this._maintenance);var error=new Error('SQL Server pool has ended');
  while(this._waiters.length)this._settleWaiter(this._waiters.shift(),null,error);
  var connections=Array.from(this._all);this._idle.length=0;this._all.clear();this._borrowed.clear();
  await Promise.all(connections.map(function(connection){return connection.end();}));
};
Object.defineProperties(Pool.prototype,{
  totalCount:{get:function(){return this._all.size;}},idleCount:{get:function(){return this._idle.length;}},borrowedCount:{get:function(){return this._borrowed.size;}},waitingCount:{get:function(){return this._waiters.filter(function(waiter){return !waiter.settled;}).length;}}
});

exports.Pool=Pool;
