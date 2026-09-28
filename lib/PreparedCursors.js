'use strict';

var QueryAttributes = require('./QueryAttributes');
var Sequences = require('./protocol/sequences');

exports.decorateConnection = decorateConnection;
exports.decoratePromiseConnection = decoratePromiseConnection;

function decorateConnection(connection) {
  if (typeof connection.openCursor === 'function') {
    return connection;
  }

  Object.defineProperty(connection, 'openCursor', {
    configurable : true,
    enumerable   : false,
    value        : function openCursor(sql, values, options, callback) {
      var normalized = normalizeOpenCursor(sql, values, options, callback);
      var self = this;

      this._implyConnect();

      var prepare = new Sequences.Prepare({
        sql              : normalized.sql,
        timeout          : normalized.options.timeout,
        operationTimeout : normalized.options.operationTimeout,
        signal           : normalized.options.signal
      }, function onPrepared(error, statement) {
        if (error) {
          finish(normalized.callback, error);
          return;
        }

        var open = new Sequences.OpenCursor({
          statement  : statement,
          values     : normalized.values,
          attributes : QueryAttributes.capture(normalized.options.attributes, 'cursor'),
          timeout    : normalized.options.timeout,
          typeCast   : normalized.options.typeCast,
          nestTables : normalized.options.nestTables,
          signal     : normalized.options.signal
        }, function onOpened(openError, fields) {
          if (openError) {
            self._protocol._enqueue(closeSequence(statement));
            finish(normalized.callback, openError);
            return;
          }

          finish(normalized.callback, null, createCursor(self, statement, fields, normalized.options));
        });

        open._connection = self;
        self._protocol._enqueue(open);
      });

      prepare._connection = this;
      return this._protocol._enqueue(prepare);
    }
  });

  return connection;
}

function decoratePromiseConnection(promiseConnection) {
  var prototype = Object.getPrototypeOf(promiseConnection);

  if (typeof prototype.openCursor !== 'function') {
    Object.defineProperty(prototype, 'openCursor', {
      configurable : true,
      enumerable   : false,
      value        : function openCursor(sql, values, options) {
        var connection = decorateConnection(this.connection);
        var PromiseImpl = this.Promise;

        return new PromiseImpl(function (resolve, reject) {
          connection.openCursor(sql, values, options, function onCursor(error, cursor) {
            if (error) {
              reject(error);
              return;
            }

            resolve(createPromiseCursor(cursor, PromiseImpl));
          });
        });
      }
    });
  }

  return promiseConnection;
}

function createCursor(connection, statement, fields, options) {
  var cursor = {
    statementId : statement.id,
    fields      : fields,
    done        : false,
    closed      : false
  };

  cursor.fetch = function fetch(rowCount, callback) {
    if (typeof rowCount === 'function') {
      callback = rowCount;
      rowCount = undefined;
    }

    if (cursor.closed) {
      finish(callback, cursorError('PREPARED_CURSOR_CLOSED', 'Prepared cursor is closed'));
      return cursor;
    }

    if (cursor.done) {
      finish(callback, null, [], {done: true});
      return cursor;
    }

    var fetchSize = rowCount === undefined ? (options.fetchSize || 100) : rowCount;
    var sequence = new Sequences.FetchCursor({
      statementId : statement.id,
      fields      : fields,
      rowCount    : fetchSize,
      timeout     : options.timeout,
      typeCast    : options.typeCast,
      nestTables  : options.nestTables,
      signal      : options.signal
    }, function onFetched(error, rows, state) {
      if (!error && state) {
        cursor.done = state.done;
      }

      finish(callback, error, rows, state);
    });

    sequence._connection = connection;
    connection._protocol._enqueue(sequence);
    return cursor;
  };

  cursor.close = function close() {
    if (cursor.closed) {
      return cursor;
    }

    cursor.closed = true;
    connection._protocol._enqueue(closeSequence(statement));
    return cursor;
  };

  return cursor;
}

function createPromiseCursor(cursor, PromiseImpl) {
  var wrapper = {
    statementId : cursor.statementId,
    fields      : cursor.fields,
    fetch       : function fetch(rowCount) {
      return new PromiseImpl(function (resolve, reject) {
        cursor.fetch(rowCount, function onFetched(error, rows, state) {
          if (error) {
            reject(error);
            return;
          }

          resolve({rows: rows, done: state.done, fields: cursor.fields});
        });
      });
    },
    close: function close() {
      cursor.close();
      return PromiseImpl.resolve();
    }
  };

  Object.defineProperty(wrapper, 'done', {
    enumerable : true,
    get        : function getDone() { return cursor.done; }
  });

  Object.defineProperty(wrapper, 'closed', {
    enumerable : true,
    get        : function getClosed() { return cursor.closed; }
  });

  wrapper[Symbol.asyncIterator] = async function* iterator() {
    while (!cursor.done && !cursor.closed) {
      var batch = await wrapper.fetch();

      for (var i = 0; i < batch.rows.length; i++) {
        yield batch.rows[i];
      }
    }
  };

  return wrapper;
}

function normalizeOpenCursor(sql, values, options, callback) {
  if (typeof values === 'function') {
    callback = values;
    values = [];
    options = {};
  } else if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  options = options || {};

  if (!Array.isArray(values)) {
    values = values === undefined ? [] : values;
  }

  return {
    sql      : sql,
    values   : values,
    options  : options,
    callback : callback
  };
}

function closeSequence(statement) {
  return new Sequences.CloseStatement({statementId: statement.id});
}

function cursorError(code, message) {
  var error = new Error(message);
  error.code = code;
  return error;
}

function finish(callback) {
  if (typeof callback === 'function') {
    callback.apply(null, Array.prototype.slice.call(arguments, 1));
  }
}
