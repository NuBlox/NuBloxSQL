'use strict';

var Diagnostics = require('diagnostics_channel');
var Transaction = require('./PromiseTransaction');

var QueryStartChannel = Diagnostics.channel('nublox.mysql.query.start');
var QueryEndChannel = Diagnostics.channel('nublox.mysql.query.end');
var QueryErrorChannel = Diagnostics.channel('nublox.mysql.query.error');

module.exports = PromiseConnection;

function PromiseConnection(connection, PromiseImpl) {
  this.connection = connection;
  this.Promise = PromiseImpl || global.Promise;
}

Object.defineProperty(PromiseConnection.prototype, 'threadId', {
  get: function getThreadId() {
    return this.connection.threadId;
  }
});

Object.defineProperty(PromiseConnection.prototype, 'state', {
  get: function getState() {
    return this.connection.state;
  }
});

Object.defineProperty(PromiseConnection.prototype, 'config', {
  get: function getConfig() {
    return this.connection.config;
  }
});

PromiseConnection.prototype.connect = function connect(options) {
  var args = options === undefined ? [] : [options];
  var self = this;

  return callCallbackMethod(this, 'connect', args, function () {
    return self;
  });
};

PromiseConnection.prototype.query = function query(sql, values) {
  var PromiseImpl = this.Promise;
  var connection = this.connection;
  var signal = getAbortSignal(sql);
  var statement = getStatement(sql);

  return new PromiseImpl(function (resolve, reject) {
    var settled = false;
    var started = process.hrtime.bigint();
    var removeAbortListener = function () {};
    var queryObject;

    if (signal && signal.aborted) {
      reject(createAbortError(signal));
      return;
    }

    QueryStartChannel.publish({
      operation : 'query',
      sql       : statement,
      threadId  : connection.threadId
    });

    function rejectOnce(error) {
      if (settled) {
        return;
      }

      settled = true;
      removeAbortListener();
      QueryErrorChannel.publish({
        operation  : 'query',
        sql        : statement,
        threadId   : connection.threadId,
        durationMs : durationMs(started),
        errorCode  : error && error.code,
        errno      : error && error.errno,
        aborted    : error && error.name === 'AbortError'
      });
      reject(error);
    }

    function resolveOnce(rows, fields) {
      if (settled) {
        return;
      }

      settled = true;
      removeAbortListener();
      QueryEndChannel.publish({
        operation  : 'query',
        sql        : statement,
        threadId   : connection.threadId,
        durationMs : durationMs(started)
      });
      resolve([rows, fields]);
    }

    queryObject = connection.query(sql, values, function (error, rows, fields) {
      if (error) {
        rejectOnce(error);
        return;
      }

      resolveOnce(rows, fields);
    });

    if (signal) {
      var onAbort = function onAbort() {
        var error = createAbortError(signal);

        if (queryObject && queryObject._connection) {
          queryObject._connection.destroy();
        } else {
          connection.destroy();
        }

        rejectOnce(error);
      };

      signal.addEventListener('abort', onAbort, {once: true});
      removeAbortListener = function removeAbortListenerFn() {
        signal.removeEventListener('abort', onAbort);
      };
    }
  });
};

PromiseConnection.prototype.beginTransaction = function beginTransaction(options) {
  var args = options === undefined ? [] : [options];
  var self = this;

  return callCallbackMethod(this, 'beginTransaction', args, function () {
    return self;
  });
};

PromiseConnection.prototype.commit = function commit(options) {
  var args = options === undefined ? [] : [options];
  var self = this;

  return callCallbackMethod(this, 'commit', args, function () {
    return self;
  });
};

PromiseConnection.prototype.rollback = function rollback(options) {
  var args = options === undefined ? [] : [options];
  var self = this;

  return callCallbackMethod(this, 'rollback', args, function () {
    return self;
  });
};

PromiseConnection.prototype.changeUser = function changeUser(options) {
  var self = this;

  return callCallbackMethod(this, 'changeUser', [options || {}], function () {
    return self;
  });
};

PromiseConnection.prototype.ping = function ping(options) {
  var args = options === undefined ? [] : [options];
  var self = this;

  return callCallbackMethod(this, 'ping', args, function () {
    return self;
  });
};

PromiseConnection.prototype.statistics = function statistics(options) {
  var args = options === undefined ? [] : [options];

  return callCallbackMethod(this, 'statistics', args, function (callbackArgs) {
    return callbackArgs[0];
  });
};

PromiseConnection.prototype.end = function end(options) {
  var args = options === undefined ? [] : [options];

  return callCallbackMethod(this, 'end', args, function () {
    return undefined;
  });
};

PromiseConnection.prototype.destroy = function destroy() {
  this.connection.destroy();
};

PromiseConnection.prototype.release = function release() {
  if (typeof this.connection.release === 'function') {
    return this.connection.release();
  }

  return undefined;
};

PromiseConnection.prototype.pause = function pause() {
  this.connection.pause();
  return this;
};

PromiseConnection.prototype.resume = function resume() {
  this.connection.resume();
  return this;
};

PromiseConnection.prototype.escape = function escape(value) {
  return this.connection.escape(value);
};

PromiseConnection.prototype.escapeId = function escapeId(value) {
  return this.connection.escapeId(value);
};

PromiseConnection.prototype.format = function format(sql, values) {
  return this.connection.format(sql, values);
};

PromiseConnection.prototype.stream = function stream(sql, values, options) {
  return this.connection.query(sql, values).stream(options);
};

PromiseConnection.prototype.iterate = function iterate(sql, values, options) {
  return this.stream(sql, values, options);
};

PromiseConnection.prototype.withTransaction = function withTransaction(work, options) {
  return Transaction.run(this, work, options);
};

PromiseConnection.prototype.promise = function promise() {
  return this;
};

function callCallbackMethod(self, method, args, mapResult) {
  var PromiseImpl = self.Promise;
  var connection = self.connection;

  return new PromiseImpl(function (resolve, reject) {
    var callbackArgs = args.slice();

    callbackArgs.push(function (error) {
      if (error) {
        reject(error);
        return;
      }

      var values = Array.prototype.slice.call(arguments, 1);
      resolve(mapResult ? mapResult(values) : values[0]);
    });

    connection[method].apply(connection, callbackArgs);
  });
}

function getAbortSignal(sql) {
  if (sql && typeof sql === 'object' && sql.signal) {
    return sql.signal;
  }

  return null;
}

function getStatement(sql) {
  if (typeof sql === 'string') {
    return sql;
  }

  if (sql && typeof sql.sql === 'string') {
    return sql.sql;
  }

  return undefined;
}

function createAbortError(signal) {
  var error = new Error('MySQL query aborted');

  error.name = 'AbortError';
  error.code = 'ABORT_ERR';

  if (signal && signal.reason !== undefined) {
    error.cause = signal.reason;
  }

  return error;
}

function durationMs(started) {
  return Number(process.hrtime.bigint() - started) / 1000000;
}
