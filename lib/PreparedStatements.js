'use strict';

var Diagnostics = require('diagnostics_channel');
var PreparedStatementCache = require('./PreparedStatementCache');
var PromiseConnection = require('./PromiseConnection');
var Sequences = require('./protocol/sequences');

var CacheChannel = Diagnostics.channel('nublox.mysql.statement.cache');
var LifecycleChannel = Diagnostics.channel('nublox.mysql.statement.lifecycle');

exports.decorateConnection = decorateConnection;
exports.decoratePool = decoratePool;
exports.decoratePromiseConnection = decoratePromiseConnection;
exports.decoratePromisePool = decoratePromisePool;

function decorateConnection(connection) {
  installConnectionCacheMethods(connection);
  installConnectionPrepare(connection);
  wrapChangeUser(connection);

  if (typeof connection.execute === 'function') {
    return connection;
  }

  Object.defineProperty(connection, 'execute', {
    configurable : true,
    enumerable   : false,
    value        : function execute(sql, values, callback) {
      var options = normalizeExecute(sql, values, callback);
      var state = getCacheState(this);
      var statement = state.cache.get(options.sql);

      this._implyConnect();

      if (statement) {
        publishCache('hit', this, options.sql, state);
        return enqueueExecute(this, options, state, statement, true, 0, false);
      }

      publishCache('miss', this, options.sql, state);
      return prepareAndExecute(this, options, state, 0, false);
    }
  });

  return connection;
}

function decoratePool(pool) {
  wrapPoolGetConnection(pool);

  if (typeof pool.execute === 'function') {
    return pool;
  }

  Object.defineProperty(pool, 'execute', {
    configurable : true,
    enumerable   : false,
    value        : function execute(sql, values, callback) {
      var options = normalizeExecute(sql, values, callback);
      var self = this;

      this.getConnection(function onConnection(error, connection) {
        if (error) {
          finish(options.callback, error);
          return;
        }

        connection.execute(options, function onExecute(executeError, rows, fields) {
          connection.release();
          finish(options.callback, executeError, rows, fields);
        });
      });

      return self;
    }
  });

  return pool;
}

function decoratePromiseConnection(promiseConnection) {
  installPromiseConnectionMethods(Object.getPrototypeOf(promiseConnection));
  return promiseConnection;
}

function decoratePromisePool(promisePool) {
  installPromiseConnectionMethods(PromiseConnection.prototype);

  if (typeof promisePool.execute === 'function') {
    return promisePool;
  }

  Object.defineProperty(promisePool, 'execute', {
    configurable : true,
    enumerable   : false,
    value        : function execute(sql, values) {
      var pool = decoratePool(this.pool);

      return new this.Promise(function (resolve, reject) {
        pool.execute(sql, values, function onExecute(error, rows, fields) {
          if (error) {
            reject(error);
            return;
          }

          resolve([rows, fields]);
        });
      });
    }
  });

  return promisePool;
}

function installConnectionCacheMethods(connection) {
  if (typeof connection.unprepare !== 'function') {
    Object.defineProperty(connection, 'unprepare', {
      configurable : true,
      enumerable   : false,
      value        : function unprepare(sql) {
        var state = getCacheState(this);
        var statement = state.cache.delete(sql);

        if (statement) {
          this._protocol._enqueue(closeSequence(statement));
          publishCache('unprepare', this, sql, state);
        }

        return this;
      }
    });
  }

  if (typeof connection.clearPreparedStatementCache !== 'function') {
    Object.defineProperty(connection, 'clearPreparedStatementCache', {
      configurable : true,
      enumerable   : false,
      value        : function clearPreparedStatementCache() {
        var state = getCacheState(this);
        var statements = state.cache.clear();
        var self = this;

        statements.forEach(function (statement) {
          self._protocol._enqueue(closeSequence(statement));
        });

        if (statements.length > 0) {
          publishCache('clear', this, undefined, state);
        }

        return this;
      }
    });
  }

  if (typeof connection.preparedStatementCacheStats !== 'function') {
    Object.defineProperty(connection, 'preparedStatementCacheStats', {
      configurable : true,
      enumerable   : false,
      value        : function preparedStatementCacheStats() {
        return getCacheState(this).cache.stats();
      }
    });
  }
}

function installConnectionPrepare(connection) {
  if (typeof connection.prepare === 'function') {
    return;
  }

  Object.defineProperty(connection, 'prepare', {
    configurable : true,
    enumerable   : false,
    value        : function prepare(sql, callback) {
      var options = normalizePrepare(sql, callback);
      var self = this;
      var sequence;

      this._implyConnect();

      sequence = new Sequences.Prepare({
        sql     : options.sql,
        timeout : options.timeout
      }, function onPrepared(error, rawStatement) {
        if (error) {
          finish(options.callback, error);
          return;
        }

        var statement = createManualStatement(self, rawStatement, options);
        getCacheState(self).manualStatements.push(statement);
        publishLifecycle('prepare', self, statement);
        finish(options.callback, null, statement);
      });

      sequence._connection = this;
      return this._protocol._enqueue(sequence);
    }
  });
}

function installPromiseConnectionMethods(prototype) {
  if (typeof prototype.execute !== 'function') {
    Object.defineProperty(prototype, 'execute', {
      configurable : true,
      enumerable   : false,
      value        : function execute(sql, values) {
        var connection = decorateConnection(this.connection);

        return new this.Promise(function (resolve, reject) {
          connection.execute(sql, values, function onExecute(error, rows, fields) {
            if (error) {
              reject(error);
              return;
            }

            resolve([rows, fields]);
          });
        });
      }
    });
  }

  if (typeof prototype.prepare !== 'function') {
    Object.defineProperty(prototype, 'prepare', {
      configurable : true,
      enumerable   : false,
      value        : function prepare(sql) {
        var connection = decorateConnection(this.connection);
        var PromiseImpl = this.Promise;

        return new PromiseImpl(function (resolve, reject) {
          connection.prepare(sql, function onPrepare(error, statement) {
            if (error) {
              reject(error);
              return;
            }

            resolve(createPromiseStatement(statement, PromiseImpl));
          });
        });
      }
    });
  }

  if (typeof prototype.unprepare !== 'function') {
    Object.defineProperty(prototype, 'unprepare', {
      configurable : true,
      enumerable   : false,
      value        : function unprepare(sql) {
        decorateConnection(this.connection).unprepare(sql);
        return this;
      }
    });
  }

  if (typeof prototype.clearPreparedStatementCache !== 'function') {
    Object.defineProperty(prototype, 'clearPreparedStatementCache', {
      configurable : true,
      enumerable   : false,
      value        : function clearPreparedStatementCache() {
        decorateConnection(this.connection).clearPreparedStatementCache();
        return this;
      }
    });
  }

  if (typeof prototype.preparedStatementCacheStats !== 'function') {
    Object.defineProperty(prototype, 'preparedStatementCacheStats', {
      configurable : true,
      enumerable   : false,
      value        : function preparedStatementCacheStats() {
        return decorateConnection(this.connection).preparedStatementCacheStats();
      }
    });
  }
}

function createManualStatement(connection, rawStatement, options) {
  var statement = {
    id          : rawStatement.id,
    query       : rawStatement.sql,
    sql         : rawStatement.sql,
    columns     : rawStatement.columns,
    parameters  : rawStatement.parameters,
    numColumns  : rawStatement.numColumns,
    numParams   : rawStatement.numParams,
    _closed     : false,
    _connection : connection,
    _raw        : rawStatement
  };

  statement.execute = function execute(values, callback) {
    var normalized = normalizeStatementExecute(values, callback);
    var lifecycleError = statementLifecycleError(statement);

    if (lifecycleError) {
      finish(normalized.callback, lifecycleError);
      return statement;
    }

    var sequence = new Sequences.Execute({
      statement  : statement._raw,
      values     : normalized.values,
      timeout    : options.timeout,
      typeCast   : options.typeCast,
      nestTables : options.nestTables
    }, function onExecuted(error, rows, fields) {
      publishLifecycle(error ? 'execute-error' : 'execute', connection, statement);
      finish(normalized.callback, error, rows, fields);
    });

    sequence._connection = connection;
    return connection._protocol._enqueue(sequence);
  };

  statement.close = function close() {
    if (statement._closed) {
      return statement;
    }

    statement._closed = true;
    removeManualStatement(connection, statement);
    publishLifecycle('close', connection, statement);
    connection._protocol._enqueue(closeSequence(statement._raw));
    return statement;
  };

  return statement;
}

function createPromiseStatement(statement, PromiseImpl) {
  return {
    statement  : statement,
    id         : statement.id,
    query      : statement.query,
    columns    : statement.columns,
    parameters : statement.parameters,
    execute    : function execute(values) {
      return new PromiseImpl(function (resolve, reject) {
        statement.execute(values, function onExecute(error, rows, fields) {
          if (error) {
            reject(error);
            return;
          }

          resolve([rows, fields]);
        });
      });
    },
    close: function close() {
      return new PromiseImpl(function (resolve) {
        statement.close();
        resolve();
      });
    }
  };
}

function prepareAndExecute(connection, options, state, retryCount, priority) {
  var prepare = new Sequences.Prepare({
    sql                 : options.sql,
    timeout             : options.timeout,
    operationTimeout    : options.operationTimeout,
    operationDeadlineAt : options._nubloxOperationDeadlineAt
  }, function onPrepared(error, statement) {
    if (error) {
      finish(options.callback, error);
      return;
    }

    state.cache.notePrepare();
    publishCache('prepare', connection, options.sql, state);

    var keepCached = state.cache.limit > 0;
    var removed = keepCached ? state.cache.set(options.sql, statement) : [];

    removed.forEach(function (removedStatement) {
      enqueueNext(connection._protocol, closeSequence(removedStatement));
      publishCache('evict', connection, removedStatement.sql, state);
    });

    enqueueExecute(connection, options, state, statement, keepCached, retryCount, true);
  });

  prepare._connection = connection;

  return priority
    ? enqueueNext(connection._protocol, prepare)
    : connection._protocol._enqueue(prepare);
}

function enqueueExecute(connection, options, state, statement, keepCached, retryCount, priority) {
  var executeSequence = new Sequences.Execute({
    statement           : statement,
    values              : options.values,
    timeout             : options.timeout,
    operationTimeout    : options.operationTimeout,
    operationDeadlineAt : options._nubloxOperationDeadlineAt,
    typeCast            : options.typeCast,
    nestTables          : options.nestTables
  }, function onExecuted(error, rows, fields) {
    if (error && retryCount === 0 && isReprepareError(error)) {
      var cachedStatement = state.cache.delete(options.sql);

      state.cache.noteReprepare();
      publishCache('reprepare', connection, options.sql, state);
      prepareAndExecute(connection, options, state, 1, true);

      if (cachedStatement) {
        enqueueNext(connection._protocol, closeSequence(cachedStatement));
      } else if (!keepCached) {
        enqueueNext(connection._protocol, closeSequence(statement));
      }
      return;
    }

    if (!keepCached) {
      enqueueNext(connection._protocol, closeSequence(statement));
    }

    finish(options.callback, error, rows, fields);
  });

  executeSequence._connection = connection;

  return priority
    ? enqueueNext(connection._protocol, executeSequence)
    : connection._protocol._enqueue(executeSequence);
}

function enqueueNext(protocol, sequence) {
  var active = protocol._queue[0];
  var result = protocol._enqueue(sequence);

  if (!active || protocol._queue[0] !== active) {
    return result;
  }

  var index = protocol._queue.indexOf(sequence);

  if (index > 1) {
    protocol._queue.splice(index, 1);
    protocol._queue.splice(1, 0, sequence);
  }

  return result;
}

function closeSequence(statement) {
  return new Sequences.CloseStatement({statementId: statement.id});
}

function getCacheState(connection) {
  if (connection._nubloxPreparedStatementState) {
    return connection._nubloxPreparedStatementState;
  }

  var state = {
    cache            : new PreparedStatementCache(connection.config.maxPreparedStatements),
    manualStatements : []
  };

  Object.defineProperty(connection, '_nubloxPreparedStatementState', {
    configurable : true,
    enumerable   : false,
    value        : state,
    writable     : false
  });

  return state;
}

function removeManualStatement(connection, statement) {
  var statements = getCacheState(connection).manualStatements;
  var index = statements.indexOf(statement);

  if (index !== -1) {
    statements.splice(index, 1);
  }
}

function invalidateManualStatements(connection) {
  var state = getCacheState(connection);
  var statements = state.manualStatements.slice();

  state.manualStatements.length = 0;
  statements.forEach(function (statement) {
    statement._closed = true;
    publishLifecycle('invalidate', connection, statement);
  });
}

function wrapChangeUser(connection) {
  if (connection._nubloxPreparedStatementChangeUserWrapped) {
    return;
  }

  var original = connection.changeUser;

  connection.changeUser = function changeUser() {
    var state = getCacheState(this);
    var cleared = state.cache.clear();

    invalidateManualStatements(this);

    if (cleared.length > 0) {
      publishCache('reset', this, undefined, state);
    }

    return original.apply(this, arguments);
  };

  Object.defineProperty(connection, '_nubloxPreparedStatementChangeUserWrapped', {
    configurable : true,
    enumerable   : false,
    value        : true,
    writable     : false
  });
}

function wrapPoolGetConnection(pool) {
  if (pool._nubloxPreparedStatementGetConnectionWrapped) {
    return;
  }

  var original = pool.getConnection;

  pool.getConnection = function getConnection(callback) {
    return original.call(this, function onConnection(error, connection) {
      if (connection) {
        decorateConnection(connection);
      }
      callback(error, connection);
    });
  };

  Object.defineProperty(pool, '_nubloxPreparedStatementGetConnectionWrapped', {
    configurable : true,
    enumerable   : false,
    value        : true,
    writable     : false
  });
}

function publishCache(action, connection, sql, state) {
  if (!CacheChannel.hasSubscribers) {
    return;
  }

  CacheChannel.publish({
    action       : action,
    connectionId : connection.threadId,
    sql          : sql,
    stats        : state.cache.stats()
  });
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

function statementLifecycleError(statement) {
  if (!statement._closed) {
    return null;
  }

  var error = new Error('Prepared statement is closed or no longer valid for this connection');
  error.code = 'PREPARED_STATEMENT_CLOSED';
  return error;
}

function isReprepareError(error) {
  return error.code === 'ER_NEED_REPREPARE'
    || error.code === 'ER_UNKNOWN_STMT_HANDLER';
}

function normalizePrepare(sql, callback) {
  var options = typeof sql === 'object' && sql !== null
    ? Object.create(sql)
    : {sql: sql};

  if (typeof options.sql !== 'string' || options.sql.length === 0) {
    throw new TypeError('prepare() requires a non-empty SQL string');
  }

  if (callback !== undefined && typeof callback !== 'function') {
    throw new TypeError('prepare() callback must be a function when provided');
  }

  options.callback = callback;
  return options;
}

function normalizeStatementExecute(values, callback) {
  var normalizedValues = values;
  var cb = callback;

  if (typeof normalizedValues === 'function') {
    cb = normalizedValues;
    normalizedValues = [];
  }

  if (normalizedValues === undefined || normalizedValues === null) {
    normalizedValues = [];
  }

  if (!Array.isArray(normalizedValues)) {
    throw new TypeError('prepared statement execute() values must be an array');
  }

  if (cb !== undefined && typeof cb !== 'function') {
    throw new TypeError('prepared statement execute() callback must be a function when provided');
  }

  return {
    values   : normalizedValues,
    callback : cb
  };
}

function normalizeExecute(sql, values, callback) {
  var options;
  var cb = callback;

  if (typeof sql === 'object' && sql !== null) {
    options = Object.create(sql);

    if (typeof values === 'function') {
      cb = values;
    } else if (values !== undefined) {
      options.values = values;
    }
  } else {
    options = {sql: sql};

    if (typeof values === 'function') {
      cb = values;
    } else if (values !== undefined) {
      options.values = values;
    }
  }

  if (typeof options.sql !== 'string' || options.sql.length === 0) {
    throw new TypeError('execute() requires a non-empty SQL string');
  }

  if (options.values === undefined || options.values === null) {
    options.values = [];
  }

  if (!Array.isArray(options.values)) {
    throw new TypeError('execute() values must be an array');
  }

  if (cb !== undefined && typeof cb !== 'function') {
    throw new TypeError('execute() callback must be a function when provided');
  }

  normalizeExecuteDeadline(options);
  options.callback = cb;
  return options;
}

function normalizeExecuteDeadline(options) {
  var operationTimeout = options.operationTimeout;

  if (operationTimeout === undefined || operationTimeout === null) {
    operationTimeout = 0;
  }

  if (!Number.isSafeInteger(operationTimeout) || operationTimeout < 0) {
    throw new TypeError('operationTimeout must be a non-negative safe integer');
  }

  options.operationTimeout = operationTimeout;

  if (operationTimeout === 0) {
    options._nubloxOperationDeadlineAt = 0;
    return;
  }

  var existingDeadline = options._nubloxOperationDeadlineAt;
  if (existingDeadline !== undefined && existingDeadline !== null) {
    if (!Number.isSafeInteger(existingDeadline) || existingDeadline <= 0) {
      throw new TypeError('internal operation deadline must be a positive safe integer');
    }

    options._nubloxOperationDeadlineAt = existingDeadline;
    return;
  }

  options._nubloxOperationDeadlineAt = Date.now() + operationTimeout;
}

function finish(callback, error, rows, fields) {
  if (typeof callback === 'function') {
    callback(error, rows, fields);
    return;
  }

  if (error) {
    process.nextTick(function throwError() {
      throw error;
    });
  }
}
