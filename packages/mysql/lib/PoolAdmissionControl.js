'use strict';

var Diagnostics = require('diagnostics_channel');

var DecisionChannel = Diagnostics.channel('nublox.mysql.pool.admission.decision');
var ErrorChannel = Diagnostics.channel('nublox.mysql.pool.admission.error');

exports.decoratePool = decoratePool;

function decoratePool(pool) {
  if (pool._nubloxAdmissionState) {
    return pool;
  }

  var state = {
    evaluated : 0,
    admitted  : 0,
    rejected  : 0,
    errors    : 0
  };

  Object.defineProperty(pool, '_nubloxAdmissionState', {
    configurable : true,
    enumerable   : false,
    value        : state,
    writable     : false
  });

  var originalEnqueueCallback = pool._enqueueCallback;

  pool._enqueueCallback = function _enqueueCallback(callback) {
    var hook = this.config.admissionControl;

    if (typeof hook !== 'function') {
      return originalEnqueueCallback.call(this, callback);
    }

    if (this.config.queueLimit && this._connectionQueue.length >= this.config.queueLimit) {
      return originalEnqueueCallback.call(this, callback);
    }

    var snapshot = admissionSnapshot(this);
    var decision;

    state.evaluated++;

    try {
      decision = normalizeDecision(hook(snapshot));
    } catch (error) {
      state.errors++;
      publishError(this, state, error);
      return process.nextTick(function () {
        callback(admissionHookError(error));
      });
    }

    if (!decision.allow) {
      state.rejected++;
      var rejection = admissionRejectedError(decision, snapshot);
      publishDecision(this, state, decision, snapshot);
      return process.nextTick(function () {
        callback(rejection);
      });
    }

    state.admitted++;
    publishDecision(this, state, decision, snapshot);
    return originalEnqueueCallback.call(this, callback);
  };

  Object.defineProperty(pool, 'admissionStats', {
    configurable : true,
    enumerable   : false,
    value        : function admissionStats() {
      return {
        enabled   : typeof pool.config.admissionControl === 'function',
        evaluated : state.evaluated,
        admitted  : state.admitted,
        rejected  : state.rejected,
        errors    : state.errors
      };
    }
  });

  return pool;
}

function admissionSnapshot(pool) {
  var total = pool._allConnections.length;
  var idle = pool._freeConnections.length;
  var acquiring = pool._acquiringConnections.length;
  var active = Math.max(0, total - idle);
  var limit = pool.config.connectionLimit;

  return Object.freeze({
    total          : total,
    active         : active,
    idle           : idle,
    acquiring      : acquiring,
    queued         : pool._connectionQueue.length,
    limit          : limit,
    queueLimit     : pool.config.queueLimit,
    minimumIdle    : pool.config.minimumIdle,
    utilization    : limit > 0 ? active / limit : null,
    saturated      : limit > 0 && total >= limit && idle === 0,
    circuitBreaker : typeof pool.circuitBreakerStats === 'function'
      ? pool.circuitBreakerStats()
      : null
  });
}

function normalizeDecision(value) {
  if (typeof value === 'boolean') {
    return {allow: value, reason: undefined, retryAfterMs: 0};
  }

  if (!value || typeof value !== 'object' || typeof value.allow !== 'boolean') {
    var invalid = new TypeError('admissionControl must return a boolean or an object with boolean allow');
    invalid.code = 'POOL_ADMISSION_INVALID_DECISION';
    throw invalid;
  }

  var retryAfterMs = value.retryAfterMs === undefined ? 0 : Number(value.retryAfterMs);
  if (!Number.isFinite(retryAfterMs) || retryAfterMs < 0) {
    var invalidRetry = new TypeError('admissionControl retryAfterMs must be a non-negative finite number');
    invalidRetry.code = 'POOL_ADMISSION_INVALID_DECISION';
    throw invalidRetry;
  }

  return {
    allow        : value.allow,
    reason       : value.reason === undefined ? undefined : String(value.reason),
    retryAfterMs : Math.ceil(retryAfterMs)
  };
}

function admissionRejectedError(decision, snapshot) {
  var error = new Error('Pool admission control rejected the queued acquisition.');
  error.code = 'POOL_ADMISSION_REJECTED';
  error.fatal = false;
  error.reason = decision.reason;
  error.retryAfterMs = decision.retryAfterMs;
  error.admission = snapshot;
  return error;
}

function admissionHookError(cause) {
  var error = new Error('Pool admission control hook failed.');
  error.code = 'POOL_ADMISSION_HOOK_ERROR';
  error.fatal = false;
  error.cause = cause;
  return error;
}

function publishDecision(pool, state, decision, snapshot) {
  if (!DecisionChannel.hasSubscribers) {
    return;
  }

  DecisionChannel.publish({
    allow        : decision.allow,
    reason       : decision.reason,
    retryAfterMs : decision.retryAfterMs,
    evaluated    : state.evaluated,
    admitted     : state.admitted,
    rejected     : state.rejected,
    pool         : snapshot
  });
}

function publishError(pool, state, error) {
  if (!ErrorChannel.hasSubscribers) {
    return;
  }

  ErrorChannel.publish({
    errorCode : error && error.code,
    evaluated : state.evaluated,
    errors    : state.errors,
    pool      : admissionSnapshot(pool)
  });
}
