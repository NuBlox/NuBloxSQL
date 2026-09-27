'use strict';

var assert = require('assert');
var common = require('../../common');
var path = require('path');
var test = require('utest');

var PoolCircuitBreaker = require(path.resolve(common.lib, 'PoolCircuitBreaker'));
var PoolConfig = require(path.resolve(common.lib, 'PoolConfig'));

function createPool(config, outcomes) {
  var calls = 0;
  var pending = [];
  var pool = {
    config           : config,
    _allConnections  : [],
    _freeConnections : [],
    _connectionQueue : [],
    getConnection    : function getConnection(callback) {
      calls++;
      var outcome = outcomes.shift();

      if (outcome === 'pending') {
        pending.push(callback);
        return;
      }

      process.nextTick(function () {
        if (outcome instanceof Error) {
          callback(outcome);
          return;
        }

        callback(null, outcome || {id: calls});
      });
    }
  };

  pool.calls = function getCalls() { return calls; };
  pool.pending = pending;
  return PoolCircuitBreaker.decoratePool(pool);
}

function acquisitionError(code) {
  var error = new Error(code);
  error.code = code;
  return error;
}

test('Pool circuit breaker', {
  'is disabled by default': function(done) {
    var config = new PoolConfig();
    var pool = createPool(config, [acquisitionError('ECONNREFUSED')]);

    assert.strictEqual(config.circuitBreakerThreshold, 0);
    assert.strictEqual(pool.circuitBreakerStats().enabled, false);

    pool.getConnection(function(error) {
      assert.strictEqual(error.code, 'ECONNREFUSED');
      assert.strictEqual(pool.circuitBreakerStats().state, 'closed');
      done();
    });
  },

  'opens after consecutive acquisition failures and rejects fast': function(done) {
    var config = new PoolConfig({
      circuitBreakerThreshold  : 2,
      circuitBreakerCooldownMs : 1000
    });
    var pool = createPool(config, [
      acquisitionError('ECONNREFUSED'),
      acquisitionError('ETIMEDOUT'),
      {id: 3}
    ]);

    pool.getConnection(function(firstError) {
      assert.strictEqual(firstError.code, 'ECONNREFUSED');
      assert.strictEqual(pool.circuitBreakerStats().failures, 1);

      pool.getConnection(function(secondError) {
        assert.strictEqual(secondError.code, 'ETIMEDOUT');
        assert.strictEqual(pool.circuitBreakerStats().state, 'open');

        pool.getConnection(function(openError) {
          assert.strictEqual(openError.code, 'POOL_CIRCUIT_OPEN');
          assert.strictEqual(openError.fatal, false);
          assert.ok(openError.retryAfterMs > 0);
          assert.strictEqual(pool.calls(), 2);
          assert.strictEqual(pool.circuitBreakerStats().totalRejected, 1);
          done();
        });
      });
    });
  },

  'does not count pool control errors as backend failures': function(done) {
    var config = new PoolConfig({circuitBreakerThreshold: 1});
    var pool = createPool(config, [acquisitionError('POOL_CONNLIMIT')]);

    pool.getConnection(function(error) {
      assert.strictEqual(error.code, 'POOL_CONNLIMIT');
      assert.strictEqual(pool.circuitBreakerStats().failures, 0);
      assert.strictEqual(pool.circuitBreakerStats().state, 'closed');
      done();
    });
  },

  'allows a half-open probe after cooldown and closes on success': function(done) {
    var config = new PoolConfig({
      circuitBreakerThreshold  : 1,
      circuitBreakerCooldownMs : 10
    });
    var pool = createPool(config, [acquisitionError('ECONNRESET'), {id: 2}]);

    pool.getConnection(function(error) {
      assert.strictEqual(error.code, 'ECONNRESET');
      assert.strictEqual(pool.circuitBreakerStats().state, 'open');

      pool._nubloxCircuitBreakerState.openedAt -= 20;
      pool.getConnection(function(probeError, connection) {
        assert.ifError(probeError);
        assert.strictEqual(connection.id, 2);
        assert.strictEqual(pool.circuitBreakerStats().state, 'closed');
        assert.strictEqual(pool.circuitBreakerStats().failures, 0);
        assert.strictEqual(pool.circuitBreakerStats().totalRecoveries, 1);
        done();
      });
    });
  },

  'bounds concurrent half-open probes': function(done) {
    var config = new PoolConfig({
      circuitBreakerThreshold           : 1,
      circuitBreakerCooldownMs          : 10,
      circuitBreakerHalfOpenMaxAttempts : 1
    });
    var pool = createPool(config, [acquisitionError('ECONNRESET'), 'pending']);

    pool.getConnection(function(error) {
      assert.strictEqual(error.code, 'ECONNRESET');
      pool._nubloxCircuitBreakerState.openedAt -= 20;

      pool.getConnection(function() {
        throw new Error('pending probe should not complete during test');
      });

      assert.strictEqual(pool.circuitBreakerStats().state, 'half-open');
      assert.strictEqual(pool.circuitBreakerStats().halfOpenInFlight, 1);

      pool.getConnection(function(openError) {
        assert.strictEqual(openError.code, 'POOL_CIRCUIT_OPEN');
        assert.strictEqual(pool.calls(), 2);
        done();
      });
    });
  },

  'validates breaker configuration': function() {
    assert.throws(function() {
      return new PoolConfig({circuitBreakerThreshold: -1});
    }, /circuitBreakerThreshold must be a non-negative safe integer/);

    assert.throws(function() {
      return new PoolConfig({circuitBreakerCooldownMs: 0});
    }, /circuitBreakerCooldownMs must be a positive safe integer/);

    assert.throws(function() {
      return new PoolConfig({circuitBreakerHalfOpenMaxAttempts: 0});
    }, /circuitBreakerHalfOpenMaxAttempts must be a positive safe integer/);
  }
});
