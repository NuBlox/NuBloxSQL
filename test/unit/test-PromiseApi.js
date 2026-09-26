'use strict';

var assert = require('assert');
var path = require('path');

var PromiseConnection = require(path.resolve(__dirname, '../../lib/PromiseConnection'));
var PromisePool = require(path.resolve(__dirname, '../../lib/PromisePool'));

var beginCount = 0;
var commitCount = 0;
var rollbackCount = 0;
var rawConnection;

rawConnection = {
  config           : {},
  state            : 'authenticated',
  threadId         : 42,
  beginTransaction : function beginTransaction(callback) {
    beginCount++;
    process.nextTick(callback);
  },
  commit: function commit(callback) {
    commitCount++;
    process.nextTick(callback);
  },
  rollback: function rollback(callback) {
    rollbackCount++;
    process.nextTick(callback);
  },
  query: function query(sql, values, callback) {
    var queryObject = {_connection: rawConnection};

    process.nextTick(function () {
      callback(null, [{answer: 42}], [{name: 'answer'}]);
    });

    return queryObject;
  },
  destroy  : function destroy() {},
  escape   : function escape(value) { return String(value); },
  escapeId : function escapeId(value) { return String(value); },
  format   : function format(sql) { return sql; }
};

var connection = new PromiseConnection(rawConnection, global.Promise);

connection.query('SELECT ?', [42])
  .then(function (result) {
    assert.strictEqual(result[0][0].answer, 42);
    assert.strictEqual(result[1][0].name, 'answer');

    var attempts = 0;

    return connection.withTransaction(function () {
      attempts++;

      if (attempts === 1) {
        var error = new Error('deadlock');
        error.code = 'ER_LOCK_DEADLOCK';
        return global.Promise.reject(error);
      }

      return 'committed';
    }, {
      maxRetries   : 1,
      retryDelayMs : 0
    }).then(function (value) {
      assert.strictEqual(value, 'committed');
      assert.strictEqual(attempts, 2);
      assert.strictEqual(beginCount, 2);
      assert.strictEqual(commitCount, 1);
      assert.strictEqual(rollbackCount, 1);
    });
  })
  .then(function () {
    var destroyed = false;
    var controller = new global.AbortController();
    var abortRawConnection = {
      config   : {},
      state    : 'authenticated',
      threadId : 43,
      query    : function query() {
        return {_connection: abortRawConnection};
      },
      destroy: function destroy() {
        destroyed = true;
      }
    };
    var abortConnection = new PromiseConnection(abortRawConnection, global.Promise);
    var pending = abortConnection.query({
      sql    : 'SELECT SLEEP(60)',
      signal : controller.signal
    });

    controller.abort('test cancellation');

    return pending.then(function () {
      assert.fail('aborted query should reject');
    }, function (error) {
      assert.strictEqual(error.name, 'AbortError');
      assert.strictEqual(error.code, 'ABORT_ERR');
      assert.strictEqual(destroyed, true);
    });
  })
  .then(function () {
    var pool = new PromisePool({
      _allConnections       : [{}, {}, {}],
      _freeConnections      : [{}],
      _acquiringConnections : [{}],
      _connectionQueue      : [function () {}, function () {}],
      _closed               : false,
      config                : {
        connectionLimit : 4,
        queueLimit      : 10
      }
    }, global.Promise);
    var stats = pool.stats();

    assert.deepStrictEqual(stats, {
      total       : 3,
      active      : 2,
      idle        : 1,
      acquiring   : 1,
      queued      : 2,
      limit       : 4,
      queueLimit  : 10,
      closed      : false,
      utilization : 0.5,
      saturated   : false
    });
  })
  .catch(function (error) {
    process.nextTick(function () {
      throw error;
    });
  });
