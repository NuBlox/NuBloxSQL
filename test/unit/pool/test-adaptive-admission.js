'use strict';

var assert = require('assert');
var common = require('../../common');
var path = require('path');
var test = require('utest');

var PoolAdmissionControl = require(path.resolve(common.lib, 'PoolAdmissionControl'));
var PoolConfig = require(path.resolve(common.lib, 'PoolConfig'));

function createPool(config, state) {
  state = state || {};

  var calls = 0;
  var pool = {
    config           : config,
    _allConnections  : new Array(state.total || 0),
    _freeConnections : new Array(state.idle || 0),
    _connectionQueue : new Array(state.queued || 0),
    getConnection    : function getConnection(callback) {
      calls++;
      process.nextTick(function () {
        callback(null, {id: calls});
      });
    }
  };

  pool.calls = function getCalls() { return calls; };
  return PoolAdmissionControl.decoratePool(pool);
}

test('Pool adaptive admission', {
  'is disabled by default': function(done) {
    var config = new PoolConfig({connectionLimit: 2});
    var pool = createPool(config, {total: 2, idle: 0, queued: 100});

    assert.strictEqual(pool.admissionStats().enabled, false);

    pool.getConnection(function(error, connection) {
      assert.ifError(error);
      assert.ok(connection);
      assert.strictEqual(pool.calls(), 1);
      done();
    });
  },

  'rejects new work when saturated queue reaches derived budget': function(done) {
    var config = new PoolConfig({
      connectionLimit                  : 4,
      adaptiveAdmission                : true,
      adaptiveAdmissionQueueMultiplier : 2,
      adaptiveAdmissionMinimumQueue    : 2
    });
    var pool = createPool(config, {total: 4, idle: 0, queued: 8});

    assert.strictEqual(pool.admissionStats().queueBudget, 8);

    pool.getConnection(function(error) {
      assert.ok(error);
      assert.strictEqual(error.code, 'POOL_ADMISSION_REJECTED');
      assert.strictEqual(error.fatal, false);
      assert.strictEqual(error.queueBudget, 8);
      assert.strictEqual(error.queued, 8);
      assert.strictEqual(pool.calls(), 0);
      assert.strictEqual(pool.admissionStats().totalRejected, 1);
      done();
    });
  },

  'admits work while saturated queue is below budget': function(done) {
    var config = new PoolConfig({
      connectionLimit                  : 4,
      adaptiveAdmission                : true,
      adaptiveAdmissionQueueMultiplier : 2,
      adaptiveAdmissionMinimumQueue    : 2
    });
    var pool = createPool(config, {total: 4, idle: 0, queued: 7});

    pool.getConnection(function(error) {
      assert.ifError(error);
      assert.strictEqual(pool.calls(), 1);
      done();
    });
  },

  'does not shed when an idle connection exists': function(done) {
    var config = new PoolConfig({
      connectionLimit                  : 4,
      adaptiveAdmission                : true,
      adaptiveAdmissionQueueMultiplier : 1,
      adaptiveAdmissionMinimumQueue    : 1
    });
    var pool = createPool(config, {total: 4, idle: 1, queued: 100});

    assert.strictEqual(pool.admissionStats().saturated, false);

    pool.getConnection(function(error) {
      assert.ifError(error);
      assert.strictEqual(pool.calls(), 1);
      done();
    });
  },

  'uses the configured minimum queue budget': function() {
    var config = new PoolConfig({
      connectionLimit                  : 2,
      adaptiveAdmission                : true,
      adaptiveAdmissionQueueMultiplier : 2,
      adaptiveAdmissionMinimumQueue    : 10
    });
    var pool = createPool(config, {total: 2, idle: 0});

    assert.strictEqual(pool.admissionStats().queueBudget, 10);
  },

  'never exceeds a finite hard queueLimit': function() {
    var config = new PoolConfig({
      connectionLimit                  : 10,
      queueLimit                       : 5,
      adaptiveAdmission                : true,
      adaptiveAdmissionQueueMultiplier : 3,
      adaptiveAdmissionMinimumQueue    : 10
    });
    var pool = createPool(config, {total: 10, idle: 0});

    assert.strictEqual(pool.admissionStats().queueBudget, 5);
  },

  'is disabled for unlimited connection pools': function() {
    var config = new PoolConfig({
      connectionLimit   : 0,
      adaptiveAdmission : true
    });
    var pool = createPool(config, {total: 100, idle: 0, queued: 100});

    assert.strictEqual(pool.admissionStats().enabled, false);
    assert.strictEqual(pool.admissionStats().queueBudget, 0);
  },

  'validates adaptive admission configuration': function() {
    [0, -1, Infinity, NaN].forEach(function(value) {
      assert.throws(function() {
        return new PoolConfig({adaptiveAdmissionQueueMultiplier: value});
      }, /adaptiveAdmissionQueueMultiplier must be a positive finite number/);
    });

    [-1, 1.5, Number.MAX_SAFE_INTEGER + 1].forEach(function(value) {
      assert.throws(function() {
        return new PoolConfig({adaptiveAdmissionMinimumQueue: value});
      }, /adaptiveAdmissionMinimumQueue must be a non-negative safe integer/);
    });
  }
});
