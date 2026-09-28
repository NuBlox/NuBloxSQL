'use strict';

var Diagnostics = require('diagnostics_channel');
var Sequences = require('./protocol/sequences');

var ResetChannel = Diagnostics.channel('nublox.mysql.connection.reset');

exports.decorateConnection = decorateConnection;
exports.decoratePool = decoratePool;
exports.decoratePromiseConnection = decoratePromiseConnection;
exports.decoratePromisePool = decoratePromisePool;

function decorateConnection(connection) {
  if (connection._nubloxSessionResetDecorated) {
    return connection;
  }

  defineMethod(connection, 'resetConnection', function resetConnection(options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }

    options = options || {};
    this._implyConnect();
    invalidatePreparedStatements(this);

    var self = this;
    var started = process.hrtime.bigint();
    var sequence = new Sequences.ResetConnection(options, function onReset(error, packet) {
      publishReset(self, error, started);

      if (typeof callback === 'function') {
        callback(error, packet);
      } else if (error) {
        process.nextTick(function throwResetError() {
          throw error;
        });
      }
    });

    sequence._connection = this;
    return this._protocol._enqueue(sequence);
  });

  Object.defineProperty(connection, '_nubloxSessionResetDecorated', {
    configurable : true,
    enumerable   : false,
    value        : true,
    writable     : false
  });

  return connection;
}

function decoratePool(pool) {
  if (pool._nubloxSessionResetDecorated) {
    return pool;
  }

  var originalGetConnection = pool.getConnection;

  defineMethod(pool, 'getConnection', function getConnection(callback) {
    return originalGetConnection.call(this, function onConnection(error, connection) {
      if (connection) {
        decorateConnection(connection);
      }
      callback(error, connection);
    });
  });

  Object.defineProperty(pool, '_nubloxSessionResetDecorated', {
    configurable : true,
    enumerable   : false,
    value        : true,
    writable     : false
  });

  return pool;
}

function decoratePromiseConnection(promiseConnection) {
  var prototype = Object.getPrototypeOf(promiseConnection);

  if (prototype._nubloxSessionResetDecorated) {
    return promiseConnection;
  }

  defineMethod(prototype, 'resetConnection', function resetConnection(options) {
    var PromiseImpl = this.Promise;
    var connection = decorateConnection(this.connection);
    var self = this;

    return new PromiseImpl(function (resolve, reject) {
      connection.resetConnection(options || {}, function onReset(error) {
        if (error) {
          reject(error);
          return;
        }
        resolve(self);
      });
    });
  });

  Object.defineProperty(prototype, '_nubloxSessionResetDecorated', {
    configurable : true,
    enumerable   : false,
    value        : true,
    writable     : false
  });

  return promiseConnection;
}

function decoratePromisePool(promisePool) {
  if (promisePool._nubloxSessionResetDecorated) {
    return promisePool;
  }

  var originalGetConnection = promisePool.getConnection;

  defineMethod(promisePool, 'getConnection', function getConnection() {
    return originalGetConnection.call(this).then(function (connection) {
      return decoratePromiseConnection(connection);
    });
  });

  Object.defineProperty(promisePool, '_nubloxSessionResetDecorated', {
    configurable : true,
    enumerable   : false,
    value        : true,
    writable     : false
  });

  return promisePool;
}

function invalidatePreparedStatements(connection) {
  if (typeof connection.clearPreparedStatementCache === 'function') {
    connection.clearPreparedStatementCache();
  }

  var state = connection._nubloxPreparedStatementState;
  var manualStatements = state && state.manualStatements
    ? state.manualStatements.slice()
    : [];

  manualStatements.forEach(function closeStatement(statement) {
    if (statement && typeof statement.close === 'function') {
      statement.close();
    }
  });
}

function publishReset(connection, error, started) {
  if (!ResetChannel.hasSubscribers) {
    return;
  }

  ResetChannel.publish({
    threadId   : connection.threadId,
    durationMs : Number(process.hrtime.bigint() - started) / 1000000,
    success    : !error,
    errorCode  : error && error.code
  });
}

function defineMethod(target, name, method) {
  var descriptor = Object.getOwnPropertyDescriptor(target, name) || {
    configurable : true,
    enumerable   : false,
    writable     : true
  };

  if (descriptor.configurable === false) {
    throw new TypeError('Cannot decorate non-configurable method ' + name);
  }

  Object.defineProperty(target, name, {
    configurable : descriptor.configurable !== false,
    enumerable   : descriptor.enumerable === true,
    value        : method,
    writable     : descriptor.writable !== false
  });
}
