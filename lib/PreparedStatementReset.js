'use strict';

var Diagnostics = require('diagnostics_channel');
var Sequences = require('./protocol/sequences');

var LifecycleChannel = Diagnostics.channel('nublox.mysql.statement.lifecycle');

exports.decorateConnection = decorateConnection;
exports.decoratePool = decoratePool;
exports.decoratePromiseConnection = decoratePromiseConnection;
exports.decoratePromisePool = decoratePromisePool;

function decorateConnection(connection) {
  if (connection._nubloxPreparedStatementResetWrapped) {
    return connection;
  }

  var originalPrepare = connection.prepare;

  if (typeof originalPrepare === 'function') {
    defineMethod(connection, 'prepare', function prepare(sql, callback) {
      var self = this;

      return originalPrepare.call(this, sql, function onPrepare(error, statement) {
        if (statement) {
          decorateStatement(statement, self);
        }

        if (typeof callback === 'function') {
          callback(error, statement);
          return;
        }

        if (error) {
          process.nextTick(function throwError() {
            throw error;
          });
        }
      });
    });
  }

  Object.defineProperty(connection, '_nubloxPreparedStatementResetWrapped', {
    configurable : true,
    enumerable   : false,
    value        : true,
    writable     : false
  });

  return connection;
}

function decoratePool(pool) {
  if (pool._nubloxPreparedStatementResetWrapped) {
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

  Object.defineProperty(pool, '_nubloxPreparedStatementResetWrapped', {
    configurable : true,
    enumerable   : false,
    value        : true,
    writable     : false
  });

  return pool;
}

function decoratePromiseConnection(promiseConnection) {
  installPromisePrepare(Object.getPrototypeOf(promiseConnection));
  return promiseConnection;
}

function decoratePromisePool(promisePool) {
  if (promisePool._nubloxPreparedStatementResetWrapped) {
    return promisePool;
  }

  var originalGetConnection = promisePool.getConnection;

  defineMethod(promisePool, 'getConnection', function getConnection() {
    return originalGetConnection.call(this).then(function (connection) {
      return decoratePromiseConnection(connection);
    });
  });

  Object.defineProperty(promisePool, '_nubloxPreparedStatementResetWrapped', {
    configurable : true,
    enumerable   : false,
    value        : true,
    writable     : false
  });

  return promisePool;
}

function installPromisePrepare(prototype) {
  if (prototype._nubloxPreparedStatementResetWrapped) {
    return;
  }

  var originalPrepare = prototype.prepare;

  if (typeof originalPrepare === 'function') {
    defineMethod(prototype, 'prepare', function prepare(sql) {
      var PromiseImpl = this.Promise;

      return originalPrepare.call(this, sql).then(function (statement) {
        return decoratePromiseStatement(statement, PromiseImpl);
      });
    });
  }

  Object.defineProperty(prototype, '_nubloxPreparedStatementResetWrapped', {
    configurable : true,
    enumerable   : false,
    value        : true,
    writable     : false
  });
}

function decorateStatement(statement, connection) {
  if (typeof statement.reset === 'function') {
    return statement;
  }

  Object.defineProperty(statement, 'reset', {
    configurable : true,
    enumerable   : false,
    value        : function reset(callback) {
      var lifecycleError = statementLifecycleError(statement);

      if (lifecycleError) {
        finish(callback, lifecycleError);
        return statement;
      }

      var sequence = new Sequences.ResetStatement({statementId: statement.id}, function onReset(error) {
        publishLifecycle(error ? 'reset-error' : 'reset', connection, statement);
        finish(callback, error, statement);
      });

      sequence._connection = connection;
      connection._protocol._enqueue(sequence);
      return statement;
    }
  });

  return statement;
}

function decoratePromiseStatement(promiseStatement, PromiseImpl) {
  if (typeof promiseStatement.reset === 'function') {
    return promiseStatement;
  }

  var statement = promiseStatement.statement;
  var connection = statement && statement._connection;

  if (statement && connection) {
    decorateStatement(statement, connection);
  }

  Object.defineProperty(promiseStatement, 'reset', {
    configurable : true,
    enumerable   : true,
    value        : function reset() {
      return new PromiseImpl(function (resolve, reject) {
        statement.reset(function onReset(error) {
          if (error) {
            reject(error);
            return;
          }
          resolve(promiseStatement);
        });
      });
    }
  });

  return promiseStatement;
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

function statementLifecycleError(statement) {
  if (!statement._closed) {
    return null;
  }

  var error = new Error('Prepared statement is closed or no longer valid for this connection');
  error.code = 'PREPARED_STATEMENT_CLOSED';
  return error;
}

function publishLifecycle(action, connection, statement) {
  if (!LifecycleChannel.hasSubscribers) {
    return;
  }

  LifecycleChannel.publish({
    action       : action,
    connectionId : connection.threadId,
    statementId  : statement.id,
    sql          : statement.query
  });
}

function finish(callback, error, value) {
  if (typeof callback === 'function') {
    callback(error, value);
    return;
  }

  if (error) {
    process.nextTick(function throwError() {
      throw error;
    });
  }
}
