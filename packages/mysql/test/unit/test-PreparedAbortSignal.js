'use strict';

var assert = require('assert');
var common = require('../common');
var path = require('path');
var test = require('utest');

var PreparedStatements = require(path.resolve(common.lib, 'PreparedStatements'));

function createConnection(sequences) {
  return {
    config        : {maxPreparedStatements: 0},
    threadId      : 17,
    changeUser    : function() {},
    _implyConnect : function() {},
    _protocol     : {
      _queue   : [],
      _enqueue : function(sequence) {
        sequences.push(sequence);
        this._queue.push(sequence);
        return sequence;
      }
    }
  };
}

test('Prepared AbortSignal', {
  'shares one signal across prepare and execute': function() {
    var sequences = [];
    var connection = createConnection(sequences);
    var controller = new AbortController();

    PreparedStatements.decorateConnection(connection);

    connection.execute({
      sql    : 'SELECT ?',
      values : [1],
      signal : controller.signal
    }, function() {});

    assert.strictEqual(sequences.length, 1);
    var prepare = sequences[0];
    assert.strictEqual(prepare._abortSignals.length, 1);
    assert.strictEqual(prepare._abortSignals[0], controller.signal);

    prepare.end(null, {
      id         : 21,
      sql        : 'SELECT ?',
      numParams  : 1,
      numColumns : 0,
      parameters : [],
      columns    : []
    });

    assert.strictEqual(sequences.length, 2);
    var execute = sequences[1];
    assert.strictEqual(execute._abortSignals.length, 1);
    assert.strictEqual(execute._abortSignals[0], controller.signal);
  },

  'rejects malformed execute signals before enqueue': function() {
    var sequences = [];
    var connection = createConnection(sequences);

    PreparedStatements.decorateConnection(connection);

    assert.throws(function() {
      connection.execute({
        sql    : 'SELECT 1',
        signal : {aborted: false}
      }, function() {});
    }, /signal must be an AbortSignal-like object/);

    assert.strictEqual(sequences.length, 0);
  },

  'cancels pooled execute while waiting for a connection': function() {
    var acquireCallback;
    var callbackError;
    var callbackCount = 0;
    var released = 0;
    var executed = false;
    var controller = new AbortController();
    var pool = {
      getConnection: function getConnection(callback) {
        acquireCallback = callback;
      }
    };

    PreparedStatements.decoratePool(pool);

    pool.execute({
      sql    : 'SELECT 1',
      values : [],
      signal : controller.signal
    }, function(error) {
      callbackCount++;
      callbackError = error;
    });

    controller.abort('request cancelled');

    assert.strictEqual(callbackCount, 1);
    assert.ok(callbackError);
    assert.strictEqual(callbackError.name, 'AbortError');
    assert.strictEqual(callbackError.code, 'ABORT_ERR');
    assert.strictEqual(callbackError.fatal, false);
    assert.strictEqual(callbackError.cause, 'request cancelled');

    acquireCallback(null, {
      config        : {maxPreparedStatements: 0},
      changeUser    : function() {},
      execute       : function() { executed = true; },
      release       : function() { released++; },
      _implyConnect : function() {}
    });

    assert.strictEqual(callbackCount, 1);
    assert.strictEqual(executed, false);
    assert.strictEqual(released, 1);
  },

  'rejects a pre-aborted pooled execute without acquiring': function() {
    var acquired = false;
    var callbackError;
    var controller = new AbortController();
    var pool = {
      getConnection: function getConnection() {
        acquired = true;
      }
    };

    PreparedStatements.decoratePool(pool);
    controller.abort('already cancelled');

    pool.execute({
      sql    : 'SELECT 1',
      signal : controller.signal
    }, function(error) {
      callbackError = error;
    });

    assert.strictEqual(acquired, false);
    assert.ok(callbackError);
    assert.strictEqual(callbackError.code, 'ABORT_ERR');
    assert.strictEqual(callbackError.fatal, false);
  }
});
