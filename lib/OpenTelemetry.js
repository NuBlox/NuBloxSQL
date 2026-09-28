'use strict';

var Diagnostics = require('diagnostics_channel');

var QueryStartChannel = Diagnostics.channel('nublox.mysql.query.start');
var QueryEndChannel = Diagnostics.channel('nublox.mysql.query.end');
var QueryErrorChannel = Diagnostics.channel('nublox.mysql.query.error');

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
  var pending = new global.Map();
  var instrumentedPools = new global.Map();
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

  function finishSpan(message, failed) {
    var key = correlationKey(message);
    var queue = pending.get(key);
    var entry = queue && queue.shift();
    var attributes = entry ? entry.attributes : baseAttributes(message, options);

    if (queue && queue.length === 0) {
      pending.delete(key);
    }

    if (failed) {
      var errorType = message.errorCode || (message.errno !== undefined ? String(message.errno) : 'unknown');
      attributes['error.type'] = String(errorType);

      if (message.errno !== undefined && message.errno !== null) {
        attributes['db.response.status_code'] = String(message.errno);
      }
    }

    if (durationHistogram && Number.isFinite(message.durationMs)) {
      durationHistogram.record(message.durationMs / 1000, attributes);
    }

    if (!entry) {
      return;
    }

    if (failed) {
      entry.span.setAttributes({
        'error.type'              : attributes['error.type'],
        'db.response.status_code' : attributes['db.response.status_code']
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

        callback(error, connection);
      }

      try {
        return original.call(self, complete);
      } catch (error) {
        if (!completed && poolWaitHistogram) {
          poolWaitHistogram.record(durationSeconds(started), attributes);
        }
        throw error;
      }
    }

    pool.getConnection = instrumentedGetConnection;
    instrumentedPools.set(pool, {
      instrumented : instrumentedGetConnection,
      original     : original
    });

    return adapter;
  }

  function uninstrumentPool(pool) {
    var record = instrumentedPools.get(pool);

    if (!record) {
      return adapter;
    }

    if (pool.getConnection === record.instrumented) {
      pool.getConnection = record.original;
    }

    instrumentedPools.delete(pool);
    return adapter;
  }

  var adapter = {
    enable           : function enable() {
      if (enabled) {
        return this;
      }

      QueryStartChannel.subscribe(onStart);
      QueryEndChannel.subscribe(onEnd);
      QueryErrorChannel.subscribe(onError);
      enabled = true;
      return this;
    },
    disable          : function disable() {
      if (enabled) {
        QueryStartChannel.unsubscribe(onStart);
        QueryEndChannel.unsubscribe(onEnd);
        QueryErrorChannel.unsubscribe(onError);
        pending.forEach(function (queue) {
          queue.forEach(function (entry) {
            entry.span.end();
          });
        });
        pending.clear();
        enabled = false;
      }

      instrumentedPools.forEach(function (record, pool) {
        if (pool.getConnection === record.instrumented) {
          pool.getConnection = record.original;
        }
      });
      instrumentedPools.clear();
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
  return String(message.threadId === undefined ? 'unassigned' : message.threadId) + ':' +
    String(message.operation || 'query');
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
