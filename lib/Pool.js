var mysql          = require('../');
var Connection     = require('./Connection');
var EventEmitter   = require('events').EventEmitter;
var Util           = require('util');
var PoolConnection = require('./PoolConnection');

module.exports = Pool;

Util.inherits(Pool, EventEmitter);
function Pool(options) {
  EventEmitter.call(this);
  this.config = options.config;
  this.config.connectionConfig.pool = this;

  this._acquiringConnections = [];
  this._allConnections       = [];
  this._freeConnections      = [];
  this._warmingConnections   = [];
  this._warmupWaiters        = [];
  this._warmupError          = null;
  this._connectionQueue      = [];
  this._closed               = false;
}

Pool.prototype.getConnection = function (cb) {

  if (this._closed) {
    var err = new Error('Pool is closed.');
    err.code = 'POOL_CLOSED';
    process.nextTick(function () {
      cb(err);
    });
    return;
  }

  var connection;
  var pool = this;

  if (this._freeConnections.length > 0) {
    connection = this._freeConnections.shift();
    this.acquireConnection(connection, cb);
    return;
  }

  if (this.config.connectionLimit === 0 || this._allConnections.length < this.config.connectionLimit) {
    connection = new PoolConnection(this, { config: this.config.newConnectionConfig() });

    this._acquiringConnections.push(connection);
    this._allConnections.push(connection);

    connection.connect({timeout: this.config.acquireTimeout}, function onConnect(err) {
      spliceConnection(pool._acquiringConnections, connection);

      if (pool._closed) {
        err = new Error('Pool is closed.');
        err.code = 'POOL_CLOSED';
      }

      if (err) {
        pool._purgeConnection(connection);
        cb(err);
        return;
      }

      pool.emit('connection', connection);
      pool.emit('acquire', connection);
      cb(null, connection);
    });
    return;
  }

  if (!this.config.waitForConnections) {
    process.nextTick(function(){
      var err = new Error('No connections available.');
      err.code = 'POOL_CONNLIMIT';
      cb(err);
    });
    return;
  }

  this._enqueueCallback(cb);
};

Pool.prototype.warmup = function warmup(count, cb) {
  if (typeof count === 'function') {
    cb = count;
    count = undefined;
  }

  cb = typeof cb === 'function'
    ? cb
    : function (err) { if (err) throw err; };

  var target = count === undefined ? this.config.minimumIdle : Number(count);
  if (!Number.isInteger(target) || target < 0) {
    process.nextTick(function () {
      cb(poolWarmupError('minimum idle target must be a non-negative integer', 'POOL_INVALID_MINIMUM_IDLE'));
    });
    return;
  }

  if (this.config.connectionLimit > 0 && target > this.config.connectionLimit) {
    process.nextTick(function () {
      cb(poolWarmupError('minimum idle target cannot exceed connectionLimit', 'POOL_MINIMUM_IDLE_EXCEEDS_LIMIT'));
    });
    return;
  }

  if (this._closed) {
    process.nextTick(function () {
      cb(poolWarmupError('Pool is closed.', 'POOL_CLOSED'));
    });
    return;
  }

  var pool = this;
  var projectedIdle = this._freeConnections.length + this._warmingConnections.length;
  var needed = Math.max(0, target - projectedIdle);
  var capacity = this.config.connectionLimit === 0
    ? needed
    : Math.max(0, this.config.connectionLimit - this._allConnections.length);
  var createCount = Math.min(needed, capacity);

  if (createCount === 0) {
    if (this._freeConnections.length < target && this._warmingConnections.length > 0) {
      this._warmupWaiters.push({target: target, callback: cb});
      return;
    }

    process.nextTick(function () {
      cb(null, pool._warmupResult(target, 0));
    });
    return;
  }

  var pending = createCount;
  var created = 0;
  var firstError = null;

  for (var i = 0; i < createCount; i++) {
    createWarmConnection();
  }

  function createWarmConnection() {
    var connection = new PoolConnection(pool, { config: pool.config.newConnectionConfig() });

    pool._warmingConnections.push(connection);
    pool._acquiringConnections.push(connection);
    pool._allConnections.push(connection);

    connection.connect({timeout: pool.config.acquireTimeout}, function onConnect(err) {
      spliceConnection(pool._warmingConnections, connection);
      spliceConnection(pool._acquiringConnections, connection);

      if (pool._closed && !err) {
        err = poolWarmupError('Pool is closed.', 'POOL_CLOSED');
      }

      if (err) {
        firstError = firstError || err;
        pool._warmupError = pool._warmupError || err;
        pool._purgeConnection(connection);
      } else {
        created++;
        pool.emit('connection', connection);
        pool._freeConnections.push(connection);

        if (pool._connectionQueue.length) {
          pool.getConnection(pool._connectionQueue.shift());
        }
      }

      pending--;
      if (pending === 0) {
        cb(firstError, pool._warmupResult(target, created));
      }

      pool._flushWarmupWaiters();
    });
  }
};

Pool.prototype._flushWarmupWaiters = function _flushWarmupWaiters() {
  if (this._warmingConnections.length !== 0 || this._warmupWaiters.length === 0) {
    return;
  }

  var error = this._warmupError;
  var waiters = this._warmupWaiters.splice(0);
  this._warmupError = null;

  for (var i = 0; i < waiters.length; i++) {
    var waiter = waiters[i];
    waiter.callback(error, this._warmupResult(waiter.target, 0));
  }
};

Pool.prototype._warmupResult = function _warmupResult(target, created) {
  return {
    target  : target,
    created : created,
    idle    : this._freeConnections.length,
    total   : this._allConnections.length,
    limited : this._freeConnections.length + this._warmingConnections.length < target
  };
};

Pool.prototype.acquireConnection = function acquireConnection(connection, cb) {
  if (connection._pool !== this) {
    throw new Error('Connection acquired from wrong pool.');
  }

  var changeUser = this._needsChangeUser(connection);
  var pool       = this;

  this._acquiringConnections.push(connection);

  function onOperationComplete(err) {
    spliceConnection(pool._acquiringConnections, connection);

    if (pool._closed) {
      err = new Error('Pool is closed.');
      err.code = 'POOL_CLOSED';
    }

    if (err) {
      pool._connectionQueue.unshift(cb);
      pool._purgeConnection(connection);
      return;
    }

    if (changeUser) {
      pool.emit('connection', connection);
    }

    pool.emit('acquire', connection);
    cb(null, connection);
  }

  if (changeUser) {
    // restore user back to pool configuration
    connection.config = this.config.newConnectionConfig();
    connection.changeUser({timeout: this.config.acquireTimeout}, onOperationComplete);
  } else {
    // ping connection
    connection.ping({timeout: this.config.acquireTimeout}, onOperationComplete);
  }
};

Pool.prototype.releaseConnection = function releaseConnection(connection) {

  if (this._acquiringConnections.indexOf(connection) !== -1) {
    // connection is being acquired
    return;
  }

  if (connection._pool) {
    if (connection._pool !== this) {
      throw new Error('Connection released to wrong pool');
    }

    if (this._freeConnections.indexOf(connection) !== -1) {
      // connection already in free connection pool
      // this won't catch all double-release cases
      throw new Error('Connection already released');
    } else {
      // add connection to end of free queue
      this._freeConnections.push(connection);
      this.emit('release', connection);
    }
  }

  if (this._closed) {
    // empty the connection queue
    this._connectionQueue.splice(0).forEach(function (cb) {
      var err = new Error('Pool is closed.');
      err.code = 'POOL_CLOSED';
      process.nextTick(function () {
        cb(err);
      });
    });
  } else if (this._connectionQueue.length) {
    // get connection with next waiting callback
    this.getConnection(this._connectionQueue.shift());
  }
};

Pool.prototype.end = function (cb) {
  this._closed = true;

  var warmupError = poolWarmupError('Pool is closed.', 'POOL_CLOSED');
  var warmupWaiters = this._warmupWaiters.splice(0);
  for (var i = 0; i < warmupWaiters.length; i++) {
    warmupWaiters[i].callback(warmupError);
  }

  if (typeof cb !== 'function') {
    cb = function (err) {
      if (err) throw err;
    };
  }

  var calledBack   = false;
  var waitingClose = 0;

  function onEnd(err) {
    if (!calledBack && (err || --waitingClose <= 0)) {
      calledBack = true;
      cb(err);
    }
  }

  while (this._allConnections.length !== 0) {
    waitingClose++;
    this._purgeConnection(this._allConnections[0], onEnd);
  }

  if (waitingClose === 0) {
    process.nextTick(onEnd);
  }
};

Pool.prototype.query = function (sql, values, cb) {
  var query = Connection.createQuery(sql, values, cb);

  if (!(typeof sql === 'object' && 'typeCast' in sql)) {
    query.typeCast = this.config.connectionConfig.typeCast;
  }

  if (this.config.connectionConfig.trace) {
    // Long stack trace support
    query._callSite = new Error();
  }

  this.getConnection(function (err, conn) {
    if (err) {
      query.on('error', function () {});
      query.end(err);
      return;
    }

    // Release connection based off event
    query.once('end', function() {
      conn.release();
    });

    conn.query(query);
  });

  return query;
};

Pool.prototype._enqueueCallback = function _enqueueCallback(callback) {

  if (this.config.queueLimit && this._connectionQueue.length >= this.config.queueLimit) {
    process.nextTick(function () {
      var err = new Error('Queue limit reached.');
      err.code = 'POOL_ENQUEUELIMIT';
      callback(err);
    });
    return;
  }

  // Bind to domain, as dequeue will likely occur in a different domain
  var cb = process.domain
    ? process.domain.bind(callback)
    : callback;

  this._connectionQueue.push(cb);
  this.emit('enqueue');
};

Pool.prototype._needsChangeUser = function _needsChangeUser(connection) {
  var connConfig = connection.config;
  var poolConfig = this.config.connectionConfig;

  // check if changeUser values are different
  return connConfig.user !== poolConfig.user
    || connConfig.database !== poolConfig.database
    || connConfig.password !== poolConfig.password
    || connConfig.charsetNumber !== poolConfig.charsetNumber;
};

Pool.prototype._purgeConnection = function _purgeConnection(connection, callback) {
  var cb = callback || function () {};

  spliceConnection(this._warmingConnections, connection);

  if (connection.state === 'disconnected') {
    connection.destroy();
  }

  this._removeConnection(connection);

  if (connection.state !== 'disconnected' && !connection._protocol._quitSequence) {
    connection._realEnd(cb);
    return;
  }

  process.nextTick(cb);
};

Pool.prototype._removeConnection = function(connection) {
  connection._pool = null;

  // Remove connection from all connections
  spliceConnection(this._allConnections, connection);

  // Remove connection from free connections
  spliceConnection(this._freeConnections, connection);

  this.releaseConnection(connection);
};

Pool.prototype.escape = function(value) {
  return mysql.escape(value, this.config.connectionConfig.stringifyObjects, this.config.connectionConfig.timezone);
};

Pool.prototype.escapeId = function escapeId(value) {
  return mysql.escapeId(value, false);
};

function spliceConnection(array, connection) {
  var index;
  if ((index = array.indexOf(connection)) !== -1) {
    // Remove connection from all connections
    array.splice(index, 1);
  }
}

function poolWarmupError(message, code) {
  var err = new Error(message);
  err.code = code;
  return err;
}
