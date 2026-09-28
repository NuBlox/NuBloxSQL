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
  var pending = new Map();
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
        entry.span.setStatus({
          code    : api.SpanStatusCode && api.SpanStatusCode.ERROR !== undefined
            ? api.SpanStatusCode.ERROR
            : 2,
          message : message.errorCode || undefined
        });
      }
    }

    entry.span.end();
  }

  return {
    enable: function enable() {
      if (enabled) {
        return this;
      }

      QueryStartChannel.subscribe(onStart);
      QueryEndChannel.subscribe(onEnd);
      QueryErrorChannel.subscribe(onError);
      enabled = true;
      return this;
    },
    disable: function disable() {
      if (!enabled) {
        return this;
      }

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
      return this;
    },
    isEnabled: function isEnabled() {
      return enabled;
    }
  };
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
