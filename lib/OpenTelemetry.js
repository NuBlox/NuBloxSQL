'use strict';

var Diagnostics = require('diagnostics_channel');

var QueryStartChannel = Diagnostics.channel('nublox.mysql.query.start');
var QueryEndChannel = Diagnostics.channel('nublox.mysql.query.end');
var QueryErrorChannel = Diagnostics.channel('nublox.mysql.query.error');
var QuerySlowChannel = Diagnostics.channel('nublox.mysql.query.slow');
var TransactionRetryChannel = Diagnostics.channel('nublox.mysql.transaction.retry');

module.exports = createOpenTelemetryAdapter;
module.exports.createOpenTelemetryAdapter = createOpenTelemetryAdapter;

function createOpenTelemetryAdapter(options) {
  options = options || {};

  var api = options.api || loadOpenTelemetryApi();
  var tracer = options.tracer || api.trace.getTracer(
    options.instrumentationName || '@nublox/mysql',
    options.instrumentationVersion
  );
  var meter = options.meter || (api.metrics && api.metrics.getMeter
    ? api.metrics.getMeter(options.instrumentationName || '@nublox/mysql', options.instrumentationVersion)
    : null);
  var durationHistogram = meter && typeof meter.createHistogram === 'function'
    ? meter.createHistogram('db.client.operation.duration', {
      description : 'Duration of NuBloxSQL database client operations',
      unit        : 's'
    })
    : null;
  var poolWaitHistogram = meter && typeof meter.createHistogram === 'function'
    ? meter.createHistogram('db.client.connection.wait_time', {
      description : 'Time spent obtaining a connection from a NuBloxSQL pool',
      unit        : 's'
    })
    : null;
  var poolUseHistogram = meter && typeof meter.createHistogram === 'function'
    ? meter.createHistogram('db.client.connection.use_time', {
      description : 'Time a NuBloxSQL pooled connection remains borrowed',
      unit        : 's'
    })
    : null;
  var poolConnectionCounter = meter && typeof meter.createUpDownCounter === 'function'
    ? meter.createUpDownCounter('db.client.connection.count', {
      description : 'Number of open NuBloxSQL pool connections by state',
      unit        : '{connection}'
    })
    : null;
  var poolPendingCounter = meter && typeof meter.createUpDownCounter === 'function'
    ? meter.createUpDownCounter('db.client.connection.pending_requests', {
      description : 'Number of requests currently waiting for a NuBloxSQL pool connection',
      unit        : '{request}'
    })
    : null;
  var errorCounter = meter && typeof meter.createCounter === 'function'
    ? meter.createCounter('db.client.operation.errors', {
      description : 'NuBloxSQL database client operation errors',
      unit        : '{error}'
    })
    : null;
  var retryCounter = meter && typeof meter.createCounter === 'function'
    ? meter.createCounter('db.client.operation.retries', {
      description : 'NuBloxSQL transaction retries',
      unit        : '{retry}'
    })
    : null;
  var slowQueryThresholdMs = normalizeSlowQueryThreshold(options.slowQueryThresholdMs);
  var pending = new global.Map();
  var instrumentedPools = new global.Map();
  var instrumentedLeases = new global.Map();
  var enabled = false;

  function onStart(message) {
    var attributes = baseAttributes(message, options);
    var spanName = buildSpanName(message, options);
    var spanOptions = {
      attributes : attributes,
      kind       : api.SpanKind && api.SpanKind.CLIENT !== undefined
        ? api.SpanKind.CLIENT
        : 2
    };
    var parentContext = api.context && typeof api.context.active === 'function'
      ? api.context.active()
      : undefined;
    var span = tracer.startSpan(spanName, spanOptions, parentContext);
    var key = correlationKey(message);
    var queue = pending.get(key);

    if (!queue) {
      queue = [];
      pending.set(key, queue);
    }

    queue.push({span: span, attributes: attributes});
  }

  function onEnd(message) {
    finishSpan(message, false);
  }

  function onError(message) {
    finishSpan(message, true);
  }

  function onRetry(message) {
    var attributes = {
      'db.system.name'              : 'mysql',
      'db.operation.name'           : 'transaction',
      'nublox.mysql.error.category' : classifyError(message),
      'nublox.mysql.retry.attempt'  : Number(message.attempt || 0),
      'nublox.mysql.retry.delay_ms' : Number(message.delayMs || 0)
    };

    if (message.errorCode) {
      attributes['error.type'] = String(message.errorCode);
    }

    if (message.errno !== undefined && message.errno !== null) {
      attributes['db.response.status_code'] = String(message.errno);
    }

    if (retryCounter) {
      retryCounter.add(1, attributes);
    }
  }

  function finishSpan(message, failed) {
    var key = correlationKey(message);
    var queue = pending.get(key);
    var entry = queue && queue.shift();
    var attributes = entry ? entry.attributes : baseAttributes(message, options);

    if (queue && queue.length === 0) {
      pending.delete(key);
    }

    if (message.threadId !== undefined && message.threadId !== null &&
        attributes['db.mysql.thread_id'] === undefined) {
      attributes['db.mysql.thread_id'] = Number(message.threadId);

      if (entry && entry.span && typeof entry.span.setAttributes === 'function') {
        entry.span.setAttributes({'db.mysql.thread_id': Number(message.threadId)});
      }
    }

    if (failed) {
      var errorType = message.errorCode || (message.errno !== undefined ? String(message.errno) : 'unknown');
      attributes['error.type'] = String(errorType);
      attributes['nublox.mysql.error.category'] = classifyError(message);

      if (message.errno !== undefined && message.errno !== null) {
        attributes['db.response.status_code'] = String(message.errno);
      }

      if (errorCounter) {
        errorCounter.add(1, attributes);
      }
    }

    if (durationHistogram && Number.isFinite(message.durationMs)) {
      durationHistogram.record(message.durationMs / 1000, attributes);
    }

    if (isSlowQuery(message, slowQueryThresholdMs)) {
      publishSlowQuery(message, slowQueryThresholdMs, options, attributes, entry);
    }

    if (!entry) {
      return;
    }

    if (failed) {
      entry.span.setAttributes({
        'error.type'                  : attributes['error.type'],
        'db.response.status_code'     : attributes['db.response.status_code'],
        'nublox.mysql.error.category' : attributes['nublox.mysql.error.category']
      });

      if (typeof entry.span.setStatus === 'function') {
        var statusCode = api.SpanStatusCode && api.SpanStatusCode.ERROR !== undefined
          ? api.SpanStatusCode.ERROR
          : 2;
        entry.span.setStatus({code: statusCode, message: message.errorCode || undefined});
      }
    }

    entry.span.end();
  }

  function instrumentPool(pool, poolOptions) {
    if (!pool || typeof pool.getConnection !== 'function') {
      throw new TypeError('instrumentPool requires a NuBloxSQL pool');
    }

    if (instrumentedPools.has(pool)) {
      return adapter;
    }

    poolOptions = poolOptions || {};

    var original = pool.getConnection;
    var poolName = resolvePoolName(pool, poolOptions, options);
    var attributes = {'db.client.connection.pool.name': poolName};
    var poolRecord = {
      attributes   : attributes,
      instrumented : null,
      original     : original,
      state        : {idle: 0, used: 0, pending: 0}
    };

    function instrumentedGetConnection(callback) {
      var started = process.hrtime.bigint();
      var self = this;
      var completed = false;

      function complete(error, connection) {
        if (!completed) {
          completed = true;
          if (poolWaitHistogram) {
            poolWaitHistogram.record(durationSeconds(started), attributes);
          }
        }

        if (instrumentedPools.has(pool)) {
          if (!error && connection) {
            instrumentLease(pool, connection, attributes);
          }
          syncPoolState(pool);
        }

        callback(error, connection);
      }

      try {
        var result = original.call(self, complete);
        syncPoolState(pool);
        return result;
      } catch (error) {
        if (!completed && poolWaitHistogram) {
          poolWaitHistogram.record(durationSeconds(started), attributes);
        }
        syncPoolState(pool);
        throw error;
      }
    }

    poolRecord.instrumented = instrumentedGetConnection;
    pool.getConnection = instrumentedGetConnection;
    instrumentedPools.set(pool, poolRecord);
    syncPoolState(pool);

    return adapter;
  }

  function syncPoolState(pool) {
    var record = instrumentedPools.get(pool);

    if (!record) {
      return;
    }

    var next = poolState(pool);
    var previous = record.state;

    addConnectionStateDelta(record.attributes, 'idle', next.idle - previous.idle);
    addConnectionStateDelta(record.attributes, 'used', next.used - previous.used);
    addCounterDelta(poolPendingCounter, next.pending - previous.pending, record.attributes);
    record.state = next;
  }

  function clearPoolState(record) {
    addConnectionStateDelta(record.attributes, 'idle', -record.state.idle);
    addConnectionStateDelta(record.attributes, 'used', -record.state.used);
    addCounterDelta(poolPendingCounter, -record.state.pending, record.attributes);
    record.state = {idle: 0, used: 0, pending: 0};
  }

  function addConnectionStateDelta(attributes, state, delta) {
    if (!poolConnectionCounter || delta === 0) {
      return;
    }

    var stateAttributes = copyAttributes(attributes);
    stateAttributes['db.client.connection.state'] = state;
    poolConnectionCounter.add(delta, stateAttributes);
  }

  function instrumentLease(pool, connection, attributes) {
    restoreLease(connection, false);

    if (typeof connection.release !== 'function') {
      return;
    }

    var started = process.hrtime.bigint();
    var originalRelease = connection.release;
    var originalDestroy = typeof connection.destroy === 'function' ? connection.destroy : null;
    var record = {
      attributes      : attributes,
      originalDestroy : originalDestroy,
      originalRelease : originalRelease,
      pool            : pool,
      started         : started,
      wrappedDestroy  : null,
      wrappedRelease  : null
    };

    record.wrappedRelease = function wrappedRelease() {
      finishLease(connection, true);
      var result = originalRelease.apply(this, arguments);
      syncPoolState(pool);
      return result;
    };
    connection.release = record.wrappedRelease;

    if (originalDestroy) {
      record.wrappedDestroy = function wrappedDestroy() {
        finishLease(connection, true);
        var result = originalDestroy.apply(this, arguments);
        syncPoolState(pool);
        return result;
      };
      connection.destroy = record.wrappedDestroy;
    }

    instrumentedLeases.set(connection, record);
  }

  function finishLease(connection, recordMetric) {
    var record = instrumentedLeases.get(connection);

    if (!record) {
      return;
    }

    restoreLeaseMethods(connection, record);
    instrumentedLeases.delete(connection);

    if (recordMetric && poolUseHistogram) {
      poolUseHistogram.record(durationSeconds(record.started), record.attributes);
    }
  }

  function restoreLease(connection, recordMetric) {
    if (instrumentedLeases.has(connection)) {
      finishLease(connection, recordMetric);
    }
  }

  function restoreLeaseMethods(connection, record) {
    if (connection.release === record.wrappedRelease) {
      connection.release = record.originalRelease;
    }

    if (record.wrappedDestroy && connection.destroy === record.wrappedDestroy) {
      connection.destroy = record.originalDestroy;
    }
  }

  function restorePoolLeases(pool) {
    instrumentedLeases.forEach(function (record, connection) {
      if (record.pool === pool) {
        finishLease(connection, false);
      }
    });
  }

  function uninstrumentPool(pool) {
    var record = instrumentedPools.get(pool);

    if (!record) {
      return adapter;
    }

    if (pool.getConnection === record.instrumented) {
      pool.getConnection = record.original;
    }

    restorePoolLeases(pool);
    clearPoolState(record);
    instrumentedPools.delete(pool);
    return adapter;
  }

  var adapter = {
    enable: function enable() {
      if (enabled) {
        return this;
      }

      QueryStartChannel.subscribe(onStart);
      QueryEndChannel.subscribe(onEnd);
      QueryErrorChannel.subscribe(onError);
      TransactionRetryChannel.subscribe(onRetry);
      enabled = true;
      return this;
    },
    disable: function disable() {
      if (enabled) {
        QueryStartChannel.unsubscribe(onStart);
        QueryEndChannel.unsubscribe(onEnd);
        QueryErrorChannel.unsubscribe(onError);
        TransactionRetryChannel.unsubscribe(onRetry);
        pending.forEach(function (queue) {
          queue.forEach(function (entry) {
            entry.span.end();
          });
        });
        pending.clear();
        enabled = false;
      }

      var pools = Array.from(instrumentedPools.keys());
      pools.forEach(function (pool) {
        uninstrumentPool(pool);
      });
      return this;
    },
    instrumentPool   : instrumentPool,
    uninstrumentPool : uninstrumentPool,
    isEnabled        : function isEnabled() {
      return enabled;
    }
  };

  return adapter;
}

function poolState(pool) {
  var all = pool._allConnections && pool._allConnections.length || 0;
  var idle = pool._freeConnections && pool._freeConnections.length || 0;
  var acquiring = pool._acquiringConnections && pool._acquiringConnections.length || 0;
  var open = Math.max(0, all - acquiring);
  var used = Math.max(0, open - idle);
  var queued = pool._connectionQueue && pool._connectionQueue.length || 0;

  return {
    idle    : idle,
    used    : used,
    pending : queued + acquiring
  };
}

function addCounterDelta(counter, delta, attributes) {
  if (counter && delta !== 0) {
    counter.add(delta, attributes);
  }
}

function copyAttributes(attributes) {
  var copy = {};

  for (var key in attributes) {
    copy[key] = attributes[key];
  }

  return copy;
}

function baseAttributes(message, options) {
  var attributes = {
    'db.system.name'    : 'mysql',
    'db.operation.name' : message.operation || 'query'
  };

  if (options.database) {
    attributes['db.namespace'] = options.database;
  }

  if (options.host) {
    attributes['server.address'] = options.host;
  }

  if (options.port !== undefined && options.port !== null) {
    attributes['server.port'] = Number(options.port);
  }

  if (message.threadId !== undefined && message.threadId !== null) {
    attributes['db.mysql.thread_id'] = Number(message.threadId);
  }

  if (options.captureQueryText === true && message.sql) {
    attributes['db.query.text'] = message.sql;
  }

  return attributes;
}

function buildSpanName(message, options) {
  var operation = message.operation || 'query';
  var target = options.database || options.host;

  return target ? operation + ' ' + target : operation;
}

function correlationKey(message) {
  if (message.correlationId !== undefined && message.correlationId !== null) {
    return 'correlation:' + String(message.correlationId);
  }

  return String(message.threadId === undefined ? 'unassigned' : message.threadId) + ':' +
    String(message.operation || 'query');
}

function classifyError(message) {
  var code = message && message.errorCode ? String(message.errorCode) : '';
  var errno = message && message.errno;

  if ((message && message.aborted) || code === 'ABORT_ERR') {
    return 'cancelled';
  }

  if (code === 'PROTOCOL_SEQUENCE_TIMEOUT' || code === 'PROTOCOL_OPERATION_TIMEOUT' || code === 'ETIMEDOUT') {
    return 'timeout';
  }

  if (code === 'ER_LOCK_DEADLOCK' || errno === 1213) {
    return 'deadlock';
  }

  if (code === 'ER_LOCK_WAIT_TIMEOUT' || errno === 1205) {
    return 'lock_timeout';
  }

  if (code === 'ER_ACCESS_DENIED_ERROR' || code === 'ER_NOT_SUPPORTED_AUTH_MODE' || code.indexOf('AUTH_') === 0) {
    return 'authentication';
  }

  if (code === 'ER_PARSE_ERROR' || code === 'ER_SYNTAX_ERROR') {
    return 'syntax';
  }

  if (code === 'ER_DUP_ENTRY' || code === 'ER_NO_REFERENCED_ROW_2' || code === 'ER_ROW_IS_REFERENCED_2') {
    return 'constraint';
  }

  if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'EPIPE' ||
      code === 'PROTOCOL_CONNECTION_LOST' || code === 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR') {
    return 'connection';
  }

  if (code.indexOf('PROTOCOL_') === 0 || code.indexOf('PARSER_') === 0) {
    return 'protocol';
  }

  if (code.indexOf('ER_') === 0 || (errno !== undefined && errno !== null)) {
    return 'database';
  }

  return 'unknown';
}

function isSlowQuery(message, thresholdMs) {
  var operation = message.operation || 'query';
  var sqlOperation = operation === 'query' || operation === 'execute';

  return sqlOperation && thresholdMs > 0 &&
    Number.isFinite(message.durationMs) && message.durationMs >= thresholdMs;
}

function publishSlowQuery(message, thresholdMs, options, attributes, entry) {
  var eventAttributes = {
    'db.operation.name'               : attributes['db.operation.name'],
    'db.client.operation.duration_ms' : Number(message.durationMs),
    'nublox.mysql.slow.threshold_ms'  : thresholdMs
  };

  if (attributes['db.namespace']) {
    eventAttributes['db.namespace'] = attributes['db.namespace'];
  }

  if (entry && entry.span && typeof entry.span.addEvent === 'function') {
    entry.span.addEvent('db.client.slow_query', eventAttributes);
  }

  var diagnostic = {
    operation   : message.operation || 'query',
    threadId    : message.threadId,
    durationMs  : Number(message.durationMs),
    thresholdMs : thresholdMs
  };

  if (options.captureQueryText === true && message.sql) {
    diagnostic.sql = message.sql;
  }

  QuerySlowChannel.publish(diagnostic);
}

function normalizeSlowQueryThreshold(value) {
  if (value === undefined || value === null || value === false) {
    return 0;
  }

  var threshold = Number(value);

  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new TypeError('slowQueryThresholdMs must be a non-negative finite number');
  }

  return threshold;
}

function resolvePoolName(pool, poolOptions, options) {
  if (poolOptions.name) {
    return String(poolOptions.name);
  }

  var config = pool.config && pool.config.connectionConfig;
  var host = poolOptions.host || (config && config.host) || options.host || 'localhost';
  var port = poolOptions.port || (config && config.port) || options.port || 3306;
  var database = poolOptions.database || (config && config.database) || options.database;
  var target = host + ':' + port;

  return database ? target + '/' + database : target;
}

function durationSeconds(started) {
  return Number(process.hrtime.bigint() - started) / 1000000000;
}

function loadOpenTelemetryApi() {
  try {
    return require('@opentelemetry/api');
  } catch (error) {
    var wrapped = new Error(
      'OpenTelemetry integration requires @opentelemetry/api or an explicit {api} option'
    );
    wrapped.code = 'NUBLOX_OTEL_API_MISSING';
    wrapped.cause = error;
    throw wrapped;
  }
}
