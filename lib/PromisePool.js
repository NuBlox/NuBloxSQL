'use strict';

var Diagnostics = require('diagnostics_channel');
var PromiseConnection = require('./PromiseConnection');
var Transaction = require('./PromiseTransaction');

var AcquireStartChannel = Diagnostics.channel('nublox.mysql.pool.acquire.start');
var AcquireEndChannel = Diagnostics.channel('nublox.mysql.pool.acquire.end');
var AcquireErrorChannel = Diagnostics.channel('nublox.mysql.pool.acquire.error');
var WarmupStartChannel = Diagnostics.channel('nublox.mysql.pool.warmup.start');
var WarmupEndChannel = Diagnostics.channel('nublox.mysql.pool.warmup.end');
var WarmupErrorChannel = Diagnostics.channel('nublox.mysql.pool.warmup.error');

module.exports = PromisePool;

function PromisePool(pool, PromiseImpl) {
  this.pool = pool;
  this.Promise = PromiseImpl || global.Promise;
}

Object.defineProperty(PromisePool.prototype, 'config', {
  get: function getConfig() {
    return this.pool.config;
  }
});

PromisePool.prototype.getConnection = function getConnection() {
  var PromiseImpl = this.Promise;
  var pool = this.pool;
  var started = process.hrtime.bigint();

  AcquireStartChannel.publish({stats: this.stats()});

  return new PromiseImpl(function (resolve, reject) {
    pool.getConnection(function (error, connection) {
      if (error) {
        AcquireErrorChannel.publish({
          durationMs : durationMs(started),
          errorCode  : error.code
        });
        reject(error);
        return;
      }

      AcquireEndChannel.publish({
        durationMs: durationMs(started)
      });
      resolve(new PromiseConnection(connection, PromiseImpl));
    });
  });
};

PromisePool.prototype.warmup = function warmup(count) {
  var PromiseImpl = this.Promise;
  var pool = this.pool;
  var started = process.hrtime.bigint();
  var target = count === undefined ? pool.config.minimumIdle : count;

  WarmupStartChannel.publish({
    target : target,
    stats  : this.stats()
  });

  return new PromiseImpl(function (resolve, reject) {
    pool.warmup(count, function (error, result) {
      if (error) {
        WarmupErrorChannel.publish({
          durationMs : durationMs(started),
          errorCode  : error.code,
          target     : target
        });
        reject(error);
        return;
      }

      WarmupEndChannel.publish({
        durationMs : durationMs(started),
        result     : result
      });
      resolve(result);
    });
  });
};

PromisePool.prototype.query = function query(sql, values) {
  return this.getConnection().then(function (connection) {
    return connection.query(sql, values).then(function (result) {
      connection.release();
      return result;
    }, function (error) {
      connection.release();
      throw error;
    });
  });
};

PromisePool.prototype.end = function end() {
  var PromiseImpl = this.Promise;
  var pool = this.pool;

  return new PromiseImpl(function (resolve, reject) {
    pool.end(function (error) {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
};

PromisePool.prototype.withTransaction = function withTransaction(work, options) {
  return this.getConnection().then(function (connection) {
    return Transaction.run(connection, work, options).then(function (value) {
      connection.release();
      return value;
    }, function (error) {
      connection.release();
      throw error;
    });
  });
};

PromisePool.prototype.healthCheck = function healthCheck() {
  var self = this;
  var started = process.hrtime.bigint();

  return this.getConnection().then(function (connection) {
    return connection.ping().then(function () {
      connection.release();
      return {
        ok        : true,
        latencyMs : durationMs(started),
        pool      : self.stats()
      };
    }, function (error) {
      connection.release();
      return {
        ok        : false,
        latencyMs : durationMs(started),
        errorCode : error.code,
        pool      : self.stats()
      };
    });
  }, function (error) {
    return {
      ok        : false,
      latencyMs : durationMs(started),
      errorCode : error.code,
      pool      : self.stats()
    };
  });
};

PromisePool.prototype.stats = function stats() {
  var pool = this.pool;
  var total = pool._allConnections.length;
  var idle = pool._freeConnections.length;
  var acquiring = pool._acquiringConnections.length;
  var active = Math.max(0, total - idle);
  var queued = pool._connectionQueue.length;
  var limit = pool.config.connectionLimit;
  var queueLimit = pool.config.queueLimit;

  return {
    total       : total,
    active      : active,
    idle        : idle,
    acquiring   : acquiring,
    queued      : queued,
    limit       : limit,
    minimumIdle : pool.config.minimumIdle,
    queueLimit  : queueLimit,
    closed      : pool._closed,
    utilization : limit > 0 ? active / limit : null,
    saturated   : limit > 0 && total >= limit && idle === 0
  };
};

PromisePool.prototype.circuitBreakerStats = function circuitBreakerStats() {
  if (typeof this.pool.circuitBreakerStats !== 'function') {
    return null;
  }

  return this.pool.circuitBreakerStats();
};

PromisePool.prototype.admissionStats = function admissionStats() {
  if (typeof this.pool.admissionStats !== 'function') {
    return null;
  }

  return this.pool.admissionStats();
};

PromisePool.prototype.escape = function escape(value) {
  return this.pool.escape(value);
};

PromisePool.prototype.escapeId = function escapeId(value) {
  return this.pool.escapeId(value);
};

PromisePool.prototype.stream = function stream(sql, values, options) {
  return this.pool.query(sql, values).stream(options);
};

PromisePool.prototype.iterate = function iterate(sql, values, options) {
  return this.stream(sql, values, options);
};

PromisePool.prototype.promise = function promise() {
  return this;
};

function durationMs(started) {
  return Number(process.hrtime.bigint() - started) / 1000000;
}
