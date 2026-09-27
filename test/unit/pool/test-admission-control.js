'use strict';

var assert = require('assert');
var common = require('../../common');
var path = require('path');
var test = require('utest');

var PoolAdmissionControl = require(path.resolve(common.lib, 'PoolAdmissionControl'));
var PoolConfig = require(path.resolve(common.lib, 'PoolConfig'));

function createPool(config, enqueueImpl) {
  var pool = {
    config                : config,
    _allConnections       : [{id: 1}, {id: 2}],
    _freeConnections      : [],
    _acquiringConnections : [],
    _connectionQueue      : [],
    circuitBreakerStats   : function circuitBreakerStats() {
      return {enabled: true, state: 'closed'};
    },
    _enqueueCallback : enqueueImpl || function _enqueueCallback(callback) {
      this._connectionQueue.push(callback);
    }
  };

  return PoolAdmissionControl.decoratePool(pool);
}

test('Pool admission control', {
  'is disabled by default': function() {
    var pool = createPool(new PoolConfig({connectionLimit: 2}));

    pool._enqueueCallback(function() {});

    assert.strictEqual(pool._connectionQueue.length, 1);
    assert.strictEqual(pool.admissionStats().enabled, false);
    assert.strictEqual(pool.admissionStats().evaluated, 0);
  },

  'admits saturated work from a boolean decision': function() {
    var observed;
    var pool = createPool(new PoolConfig({
      connectionLimit  : 2,
      admissionControl : function(snapshot) {
        observed = snapshot;
        return true;
      }
    }));

    pool._enqueueCallback(function() {});

    assert.strictEqual(observed.saturated, true);
    assert.strictEqual(observed.utilization, 1);
    assert.strictEqual(observed.circuitBreaker.state, 'closed');
    assert.strictEqual(pool._connectionQueue.length, 1);
    assert.deepStrictEqual(pool.admissionStats(), {
      enabled   : true,
      evaluated : 1,
      admitted  : 1,
      rejected  : 0,
      errors    : 0
    });
  },

  'rejects saturated work with retry metadata': function(done) {
    var pool = createPool(new PoolConfig({
      connectionLimit  : 2,
      admissionControl : function() {
        return {allow: false, reason: 'load-shed', retryAfterMs: 25.1};
      }
    }));

    pool._enqueueCallback(function(error) {
      assert.strictEqual(error.code, 'POOL_ADMISSION_REJECTED');
      assert.strictEqual(error.fatal, false);
      assert.strictEqual(error.reason, 'load-shed');
      assert.strictEqual(error.retryAfterMs, 26);
      assert.strictEqual(error.admission.saturated, true);
      assert.strictEqual(pool._connectionQueue.length, 0);
      assert.strictEqual(pool.admissionStats().rejected, 1);
      done();
    });
  },

  'preserves queueLimit as the hard cap before the adaptive hook': function(done) {
    var evaluations = 0;
    var config = new PoolConfig({
      connectionLimit  : 2,
      queueLimit       : 1,
      admissionControl : function() {
        evaluations++;
        return true;
      }
    });
    var pool = createPool(config, function originalQueueLimit(callback) {
      process.nextTick(function() {
        var error = new Error('Queue limit reached.');
        error.code = 'POOL_ENQUEUELIMIT';
        callback(error);
      });
    });

    pool._connectionQueue.push(function() {});

    pool._enqueueCallback(function(error) {
      assert.strictEqual(error.code, 'POOL_ENQUEUELIMIT');
      assert.strictEqual(evaluations, 0);
      assert.strictEqual(pool.admissionStats().evaluated, 0);
      done();
    });
  },

  'converts hook failures to non-fatal pool errors': function(done) {
    var pool = createPool(new PoolConfig({
      connectionLimit  : 2,
      admissionControl : function() {
        var error = new Error('policy failed');
        error.code = 'POLICY_FAILURE';
        throw error;
      }
    }));

    pool._enqueueCallback(function(error) {
      assert.strictEqual(error.code, 'POOL_ADMISSION_HOOK_ERROR');
      assert.strictEqual(error.fatal, false);
      assert.strictEqual(error.cause.code, 'POLICY_FAILURE');
      assert.strictEqual(pool.admissionStats().errors, 1);
      done();
    });
  },

  'rejects invalid decisions': function(done) {
    var pool = createPool(new PoolConfig({
      connectionLimit  : 2,
      admissionControl : function() {
        return {reason: 'missing allow'};
      }
    }));

    pool._enqueueCallback(function(error) {
      assert.strictEqual(error.code, 'POOL_ADMISSION_HOOK_ERROR');
      assert.strictEqual(error.cause.code, 'POOL_ADMISSION_INVALID_DECISION');
      done();
    });
  },

  'validates admissionControl configuration': function() {
    assert.throws(function() {
      return new PoolConfig({admissionControl: {allow: true}});
    }, /admissionControl must be a function/);
  }
});
