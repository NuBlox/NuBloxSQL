'use strict';

var assert = require('assert');
var common = require('../../common');
var path = require('path');
var test = require('utest');

var Query = require(path.resolve(common.lib, 'protocol/sequences/Query'));

test('operationTimeout', {
  'defaults to disabled': function() {
    var query = new Query({sql: 'SELECT 1'});

    assert.strictEqual(query._operationTimeout, 0);
    assert.strictEqual(query._operationDeadlineAt, 0);
  },

  'creates an absolute non-refreshing deadline': function() {
    var before = Date.now();
    var query = new Query({sql: 'SELECT 1', operationTimeout: 1000});
    var after = Date.now();

    assert.strictEqual(query._operationTimeout, 1000);
    assert.ok(query._operationDeadlineAt >= before + 1000);
    assert.ok(query._operationDeadlineAt <= after + 1000);
  },

  'accepts zero to disable the operation deadline': function() {
    var query = new Query({sql: 'SELECT 1', operationTimeout: 0});

    assert.strictEqual(query._operationTimeout, 0);
    assert.strictEqual(query._operationDeadlineAt, 0);
  },

  'rejects invalid operation deadlines': function() {
    [-1, 1.5, Number.MAX_SAFE_INTEGER + 1].forEach(function(value) {
      assert.throws(function() {
        return new Query({sql: 'SELECT 1', operationTimeout: value});
      }, /operationTimeout must be a non-negative safe integer/);
    });
  }
});
