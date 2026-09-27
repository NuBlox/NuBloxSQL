'use strict';

var Diagnostics = require('diagnostics_channel');

var StateChannel = Diagnostics.channel('nublox.mysql.pool.circuit_breaker.state');
var RejectChannel = Diagnostics.channel('nublox.mysql.pool.circuit_breaker.reject');

exports.decoratePool = decoratePool;

function decoratePool(pool) {
  if (pool._nubloxCircuitBreakerState) {
    return pool;
  }

  var config = pool.config;
  var state = {
    failures         : 0,
    openedAt         : 0,
    halfOpenInFlight : 0,
    state            : 'closed',
    totalOpened      : 0,
    totalRejected    : 0,
    totalRecoveries  : 0
  };

  Object.defineProperty(pool, '_nubloxCircuitBreakerState', {
    configurable : true,
    enumerable   : false,
    value        : state,
    writable     : false
  });

  var originalGetConnection = pool.getConnection;

  pool.getConnection = function getConnection(callback) {
    if (!isEnabled(config)) {
      return originalGetConnection.call(this, callback);
    }

    var admission = admit(config, state);
    if (!admission.allowed) {
      var error = circuitOpenError(config, state, admission.retryAfterMs);
      state.totalRejected++;
      publishReject(pool, state, error);
      process.nextTick(function () {
        callback(error);
      });
      return;
    }

    var halfOpenProbe = admission.halfOpenProbe;
    var called = false;

    return originalGetConnection.call(this, function onConnection(error, connection) {
      if (called) {
        return;
      }
      called = true;

      if (halfOpenProbe && state.halfOpenInFlight > 0) {
        state.halfOpenInFlight--;
      }

      if (!error) {
        noteSuccess(pool, state);
        callback(null, connection);
        return;
      }

      if (isAcquisitionFailure(error)) {
        noteFailure(pool, config, state, error);
      } else if (halfOpenProbe && state.state === 'half-open') {
        reopen(pool, state, error && error.code);
      }

      callback(error);
    });
  };

  Object.defineProperty(pool, 'circuitBreakerStats', {
    configurable : true,
    enumerable   : false,
    value        : function circuitBreakerStats() {
      return snapshot(config, state);
    }
  });

  return pool;
}

function isEnabled(config) {
  return config.circuitBreakerThreshold > 0;
}

function admit(config, state) {
  if (state.state === 'closed') {
    return {allowed: true, halfOpenProbe: false, retryAfterMs: 0};
  }

  if (state.state === 'open') {
    var elapsed = Date.now() - state.openedAt;
    if (elapsed < config.circuitBreakerCooldownMs) {
      return {
        allowed       : false,
        halfOpenProbe : false,
        retryAfterMs  : config.circuitBreakerCooldownMs - elapsed
      };
    }

    transition(state, 'half-open');
  }

  if (state.halfOpenInFlight >= config.circuitBreakerHalfOpenMaxAttempts) {
    return {
      allowed       : false,
      halfOpenProbe : false,
      retryAfterMs  : 0
    };
  }

  state.halfOpenInFlight++;
  return {allowed: true, halfOpenProbe: true, retryAfterMs: 0};
}

function noteSuccess(pool, state) {
  var wasRecovering = state.state !== 'closed' || state.failures > 0;

  state.failures = 0;
  state.openedAt = 0;
  state.halfOpenInFlight = 0;

  if (state.state !== 'closed') {
    transition(state, 'closed');
    state.totalRecoveries++;
  }

  if (wasRecovering) {
    publishState(pool, state, 'success');
  }
}

function noteFailure(pool, config, state, error) {
  state.failures++;

  if (state.state === 'half-open' || state.failures >= config.circuitBreakerThreshold) {
    reopen(pool, state, error && error.code);
  }
}

function reopen(pool, state, errorCode) {
  var previous = state.state;

  state.openedAt = Date.now();
  state.halfOpenInFlight = 0;
  state.totalOpened++;
  transition(state, 'open');

  if (previous !== 'open') {
    publishState(pool, state, errorCode || 'acquisition-failure');
  }
}

function transition(state, next) {
  state.state = next;
}

function snapshot(config, state) {
  var retryAfterMs = 0;

  if (state.state === 'open') {
    retryAfterMs = Math.max(
      0,
      config.circuitBreakerCooldownMs - (Date.now() - state.openedAt)
    );
  }

  return {
    enabled          : isEnabled(config),
    state            : state.state,
    failures         : state.failures,
    threshold        : config.circuitBreakerThreshold,
    cooldownMs       : config.circuitBreakerCooldownMs,
    retryAfterMs     : retryAfterMs,
    halfOpenInFlight : state.halfOpenInFlight,
    halfOpenLimit    : config.circuitBreakerHalfOpenMaxAttempts,
    totalOpened      : state.totalOpened,
    totalRejected    : state.totalRejected,
    totalRecoveries  : state.totalRecoveries
  };
}

function circuitOpenError(config, state, retryAfterMs) {
  var error = new Error('Pool circuit breaker is open.');

  error.code = 'POOL_CIRCUIT_OPEN';
  error.fatal = false;
  error.retryAfterMs = retryAfterMs;
  error.circuitBreaker = snapshot(config, state);
  return error;
}

function isAcquisitionFailure(error) {
  if (!error || typeof error.code !== 'string') {
    return true;
  }

  return error.code.indexOf('POOL_') !== 0 && error.code !== 'ABORT_ERR';
}

function publishState(pool, state, reason) {
  if (!StateChannel.hasSubscribers) {
    return;
  }

  StateChannel.publish({
    state       : state.state,
    failures    : state.failures,
    totalOpened : state.totalOpened,
    reason      : reason,
    poolTotal   : pool._allConnections.length,
    poolIdle    : pool._freeConnections.length,
    poolQueued  : pool._connectionQueue.length
  });
}

function publishReject(pool, state, error) {
  if (!RejectChannel.hasSubscribers) {
    return;
  }

  RejectChannel.publish({
    state         : state.state,
    failures      : state.failures,
    retryAfterMs  : error.retryAfterMs,
    totalRejected : state.totalRejected,
    poolTotal     : pool._allConnections.length,
    poolIdle      : pool._freeConnections.length,
    poolQueued    : pool._connectionQueue.length
  });
}
