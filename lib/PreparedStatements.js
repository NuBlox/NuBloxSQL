'use strict';

var PromiseConnection = require('./PromiseConnection');
var Sequences = require('./protocol/sequences');

exports.decorateConnection = decorateConnection;
exports.decoratePool = decoratePool;
exports.decoratePromiseConnection = decoratePromiseConnection;
exports.decoratePromisePool = decoratePromisePool;

function decorateConnection(connection) {
  if (typeof connection.execute === 'function') {
    return connection;
  }

  Object.defineProperty(connection, 'execute', {
    configurable : true,
    enumerable   : false,
    value        : function execute(sql, values, callback) {
      var options = normalizeExecute(sql, values, callback);
      var self = this;
      var prepare;

      this._implyConnect();

      prepare = new Sequences.Prepare({
        sql     : options.sql,
        timeout : options.timeout
      }, function onPrepared(error, statement) {
        if (error) {
          finish(options.callback, error);
          return;
        }

        var executeSequence = new Sequences.Execute({
          statement  : statement,
          values     : options.values,
          timeout    : options.timeout,
          typeCast   : options.typeCast,
          nestTables : options.nestTables
        }, function onExecuted(executeError, rows, fields) {
          self._protocol._enqueue(new Sequences.CloseStatement({
            statementId: statement.id
          }));

          finish(options.callback, executeError, rows, fields);
        });

        executeSequence._connection = self;
        self._protocol._enqueue(executeSequence);
      });

      prepare._connection = this;
      return this._protocol._enqueue(prepare);
    }
  });

  return connection;
}

function decoratePool(pool) {
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

        decorateConnection(connection);
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
  installPromiseConnectionExecute(Object.getPrototypeOf(promiseConnection));
  return promiseConnection;
}

function decoratePromisePool(promisePool) {
  installPromiseConnectionExecute(PromiseConnection.prototype);

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

function installPromiseConnectionExecute(prototype) {
  if (typeof prototype.execute === 'function') {
    return;
  }

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

  options.callback = cb;
  return options;
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
