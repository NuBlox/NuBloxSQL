'use strict';

var Charsets = require('./protocol/constants/charsets');
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
      if (error) {
        finishReset(self, callback, error, packet, started);
        return;
      }

      restoreConfiguredBaseline(self, options, function onBaseline(restorationError) {
        finishReset(self, callback, restorationError, packet, started);
      });
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

function restoreConfiguredBaseline(connection, options, callback) {
  var statements = [];
  var database = connection.config && connection.config.database;
  var charset = configuredCharset(connection.config && connection.config.charsetNumber);

  if (database) {
    statements.push('USE ' + connection.escapeId(database));
  }

  if (charset) {
    statements.push(
      'SET NAMES ' + connection.escape(charset.charset) +
      ' COLLATE ' + connection.escape(charset.collation)
    );
  }

  runStatements(connection, statements, options, callback);
}

function runStatements(connection, statements, options, callback) {
  var index = 0;

  function next(error) {
    if (error || index >= statements.length) {
      callback(error || null);
      return;
    }

    var queryOptions = {
      sql: statements[index++]
    };

    if (options.timeout !== undefined) {
      queryOptions.timeout = options.timeout;
    }

    if (options.operationTimeout !== undefined) {
      queryOptions.operationTimeout = options.operationTimeout;
    }

    if (options.signal !== undefined) {
      queryOptions.signal = options.signal;
    }

    connection.query(queryOptions, next);
  }

  next(null);
}

function configuredCharset(charsetNumber) {
  if (!charsetNumber) {
    return null;
  }

  var collation;

  Object.keys(Charsets).some(function findCollation(name) {
    if (Charsets[name] !== charsetNumber) {
      return false;
    }

    collation = name.toLowerCase();
    return true;
  });

  if (!collation) {
    return null;
  }

  return {
    charset   : collation.split('_')[0],
    collation : collation
  };
}

function finishReset(connection, callback, error, packet, started) {
  publishReset(connection, error, started);

  if (typeof callback === 'function') {
    callback(error, packet);
  } else if (error) {
    process.nextTick(function throwResetError() {
      throw error;
    });
  }
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
