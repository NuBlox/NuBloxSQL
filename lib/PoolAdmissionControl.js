'use strict';

var Diagnostics = require('diagnostics_channel');

var RejectChannel = Diagnostics.channel('nublox.mysql.pool.admission.reject');

exports.decoratePool = decoratePool;

function decoratePool(pool) {
  if (pool._nubloxAdmissionState) {
    return pool;
  }

  var state = {
    totalRejected : 0
  };

  Object.defineProperty(pool, '_nubloxAdmissionState', {
    configurable : true,
    enumerable   : false,
    value        : state,
    writable     : false
  });

  var originalGetConnection = pool.getConnection;

  pool.getConnection = function getConnection(callback) {
    var admission = snapshot(pool, state);

    if (admission.enabled && admission.saturated && admission.queued >= admission.queueBudget) {
      var error = admissionError(admission);
      state.totalRejected++;
      admission.totalRejected = state.totalRejected;
      publishReject(admission);

      return process.nextTick(function () {
        callback(error);
      });
    }

    return originalGetConnection.call(this, callback);
  };

  Object.defineProperty(pool, 'admissionStats', {
    configurable : true,
    enumerable   : false,
    value        : function admissionStats() {
      return snapshot(pool, state);
    }
  });

  return pool;
}

function snapshot(pool, state) {
  var config = pool.config;
  var limit = config.connectionLimit;
  var total = pool._allConnections.length;
  var idle = pool._freeConnections.length;
  var queued = pool._connectionQueue.length;
  var enabled = config.adaptiveAdmission === true && limit > 0;
  var derivedBudget = enabled
    ? Math.ceil(limit * config.adaptiveAdmissionQueueMultiplier)
    : 0;
  var queueBudget = enabled
    ? Math.max(config.adaptiveAdmissionMinimumQueue, derivedBudget)
    : 0;

  if (enabled && config.queueLimit > 0) {
    queueBudget = Math.min(queueBudget, config.queueLimit);
  }

  return {
    enabled         : enabled,
    saturated       : enabled && total >= limit && idle === 0,
    total           : total,
    idle            : idle,
    queued          : queued,
    connectionLimit : limit,
    queueBudget     : queueBudget,
    multiplier      : config.adaptiveAdmissionQueueMultiplier,
    minimumQueue    : config.adaptiveAdmissionMinimumQueue,
    totalRejected   : state.totalRejected
  };
}

function admissionError(admission) {
  var error = new Error('Pool adaptive admission rejected the acquisition.');

  error.code = 'POOL_ADMISSION_REJECTED';
  error.fatal = false;
  error.queueBudget = admission.queueBudget;
  error.queued = admission.queued;
  error.admission = admission;
  return error;
}

function publishReject(admission) {
  if (!RejectChannel.hasSubscribers) {
    return;
  }

  RejectChannel.publish({
    total           : admission.total,
    idle            : admission.idle,
    queued          : admission.queued,
    connectionLimit : admission.connectionLimit,
    queueBudget     : admission.queueBudget,
    totalRejected   : admission.totalRejected
  });
}
