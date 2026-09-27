'use strict';

var assert = require('assert');
var common = require('../common');
var path = require('path');
var test = require('utest');

var PreparedStatements = require(path.resolve(common.lib, 'PreparedStatements'));

test('Prepared operation deadline', {
  'shares one absolute deadline across prepare and execute': function() {
    var sequences = [];
    var connection = {
      config        : {maxPreparedStatements: 0},
      threadId      : 7,
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

    PreparedStatements.decorateConnection(connection);

    var before = Date.now();
    connection.execute({
      sql              : 'SELECT ?',
      values           : [1],
      operationTimeout : 1000
    }, function() {});

    assert.strictEqual(sequences.length, 1);
    var prepare = sequences[0];
    assert.strictEqual(prepare._operationTimeout, 1000);
    assert.ok(prepare._operationDeadlineAt >= before + 1000);

    prepare.end(null, {
      id         : 11,
      sql        : 'SELECT ?',
      numParams  : 1,
      numColumns : 0,
      parameters : [],
      columns    : []
    });

    assert.strictEqual(sequences.length, 2);
    var execute = sequences[1];
    assert.strictEqual(execute._operationTimeout, 1000);
    assert.strictEqual(execute._operationDeadlineAt, prepare._operationDeadlineAt);
  },

  'preserves an existing absolute deadline across pool-style renormalization': function() {
    var sequences = [];
    var connection = {
      config        : {maxPreparedStatements: 0},
      threadId      : 8,
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

    PreparedStatements.decorateConnection(connection);

    var deadline = Date.now() + 5000;
    connection.execute({
      sql                        : 'SELECT 1',
      values                     : [],
      operationTimeout           : 5000,
      _nubloxOperationDeadlineAt : deadline
    }, function() {});

    assert.strictEqual(sequences[0]._operationDeadlineAt, deadline);
  },

  'rejects invalid prepared operationTimeout values before enqueue': function() {
    var connection = {
      config        : {maxPreparedStatements: 0},
      changeUser    : function() {},
      _implyConnect : function() {},
      _protocol     : {
        _queue   : [],
        _enqueue : function() {
          throw new Error('should not enqueue');
        }
      }
    };

    PreparedStatements.decorateConnection(connection);

    assert.throws(function() {
      connection.execute({sql: 'SELECT 1', operationTimeout: -1}, function() {});
    }, /operationTimeout must be a non-negative safe integer/);
  }
});
