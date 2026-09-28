'use strict';

var Diagnostics = require('diagnostics_channel');

var RetryChannel = Diagnostics.channel('nublox.mysql.transaction.retry');
var StartChannel = Diagnostics.channel('nublox.mysql.query.start');
var EndChannel = Diagnostics.channel('nublox.mysql.query.end');
var ErrorChannel = Diagnostics.channel('nublox.mysql.query.error');
var ISOLATION_LEVELS = {
  'READ COMMITTED'   : true,
  'READ UNCOMMITTED' : true,
  'REPEATABLE READ'  : true,
  'SERIALIZABLE'     : true
};

exports.run = function run(connection, work, options) {
  if (typeof work !== 'function') {
    throw new TypeError('transaction work must be a function');
  }

  options = options || {};

  var maxRetries = normalizeNonNegativeInteger(options.maxRetries, 0, 'maxRetries');
  var retryDelayMs = normalizeNonNegativeNumber(options.retryDelayMs, 25, 'retryDelayMs');
  var maxRetryDelayMs = normalizeNonNegativeNumber(options.maxRetryDelayMs, 1000, 'maxRetryDelayMs');
  var PromiseImpl = connection.Promise;
  var attempt = 0;
  var threadId = connection.threadId;

  StartChannel.publish({
    operation      : 'transaction',
    threadId       : threadId,
    isolationLevel : normalizePublishedIsolationLevel(options.isolationLevel),
    readOnly       : options.readOnly === true,
    maxRetries     : maxRetries
  });

  function executeAttempt() {
    var currentAttempt = attempt++;

    return begin(connection, options)
      .then(function () {
        return PromiseImpl.resolve(work(connection, currentAttempt));
      })
      .then(function (value) {
        return connection.commit().then(function () {
          return value;
        });
      })
      .catch(function (error) {
        return rollbackPreservingError(connection, error)
          .then(function () {
            if (!shouldRetry(error, currentAttempt, maxRetries, options)) {
              throw error;
            }

            var delayMs = calculateDelay(currentAttempt, retryDelayMs, maxRetryDelayMs);

            RetryChannel.publish({
              attempt   : currentAttempt + 1,
              delayMs   : delayMs,
              errorCode : error && error.code,
              errno     : error && error.errno
            });

            return delay(PromiseImpl, delayMs).then(executeAttempt);
          });
      });
  }

  return executeAttempt().then(function (value) {
    EndChannel.publish({
      operation : 'transaction',
      threadId  : threadId,
      attempts  : attempt
    });
    return value;
  }, function (error) {
    ErrorChannel.publish({
      operation : 'transaction',
      threadId  : threadId,
      attempts  : attempt,
      errorCode : error && error.code,
      errno     : error && error.errno
    });
    throw error;
  });
};

function begin(connection, options) {
  var PromiseImpl = connection.Promise;
  var sequence = PromiseImpl.resolve();

  if (options.isolationLevel !== undefined) {
    var isolationLevel = String(options.isolationLevel).toUpperCase();

    if (!ISOLATION_LEVELS[isolationLevel]) {
      throw new TypeError('Unsupported transaction isolation level: ' + options.isolationLevel);
    }

    sequence = sequence.then(function () {
      return connection.query('SET TRANSACTION ISOLATION LEVEL ' + isolationLevel);
    });
  }

  return sequence.then(function () {
    if (options.readOnly === true) {
      return connection.query('START TRANSACTION READ ONLY');
    }

    return connection.beginTransaction();
  });
}

function rollbackPreservingError(connection, originalError) {
  return connection.rollback().catch(function (rollbackError) {
    if (originalError && typeof originalError === 'object') {
      originalError.rollbackError = rollbackError;
    }
  });
}

function shouldRetry(error, attempt, maxRetries, options) {
  if (attempt >= maxRetries) {
    return false;
  }

  if (typeof options.shouldRetry === 'function') {
    return Boolean(options.shouldRetry(error, attempt));
  }

  if (!error) {
    return false;
  }

  return error.code === 'ER_LOCK_DEADLOCK'
    || error.code === 'ER_LOCK_WAIT_TIMEOUT'
    || error.errno === 1213
    || error.errno === 1205;
}

function calculateDelay(attempt, retryDelayMs, maxRetryDelayMs) {
  if (retryDelayMs === 0) {
    return 0;
  }

  var exponential = Math.min(maxRetryDelayMs, retryDelayMs * Math.pow(2, attempt));
  var jitter = Math.floor(Math.random() * Math.max(1, Math.floor(exponential / 4)));

  return Math.min(maxRetryDelayMs, exponential + jitter);
}

function delay(PromiseImpl, delayMs) {
  if (delayMs === 0) {
    return PromiseImpl.resolve();
  }

  return new PromiseImpl(function (resolve) {
    setTimeout(resolve, delayMs);
  });
}

function normalizePublishedIsolationLevel(value) {
  if (value === undefined) {
    return undefined;
  }

  return String(value).toUpperCase();
}

function normalizeNonNegativeInteger(value, defaultValue, name) {
  if (value === undefined) {
    return defaultValue;
  }

  var number = Number(value);

  if (!Number.isInteger(number) || number < 0) {
    throw new TypeError(name + ' must be a non-negative integer');
  }

  return number;
}

function normalizeNonNegativeNumber(value, defaultValue, name) {
  if (value === undefined) {
    return defaultValue;
  }

  var number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    throw new TypeError(name + ' must be a non-negative number');
  }

  return number;
}
