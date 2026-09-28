'use strict';

var assert = require('assert');
var Diagnostics = require('diagnostics_channel');
var path = require('path');
var common = require('../../common');
var test = require('utest');

var createOpenTelemetryAdapter = require(path.resolve(common.lib, 'OpenTelemetry'));

function createApi() {
  var spans = [];
  var records = [];
  var adds = [];

  return {
    api: {
      SpanKind       : {CLIENT: 2},
      SpanStatusCode : {ERROR: 2},
      context        : {
        active: function active() {
          return {};
        }
      },
      trace: {
        getTracer: function getTracer() {
          return {
            startSpan: function startSpan(name, options) {
              var span = {
                name       : name,
                options    : options,
                attributes : {},
                events     : [],
                status     : null,
                ended      : false
              };
              span.setAttributes = function setAttributes(attributes) {
                Object.assign(this.attributes, attributes);
              };
              span.setStatus = function setStatus(status) {
                this.status = status;
              };
              span.addEvent = function addEvent(eventName, attributes) {
                this.events.push({name: eventName, attributes: attributes});
              };
              span.end = function end() {
                this.ended = true;
              };
              spans.push(span);
              return span;
            }
          };
        }
      },
      metrics: {
        getMeter: function getMeter() {
          return {
            createHistogram: function createHistogram(name) {
              return {
                record: function record(value, attributes) {
                  records.push({name: name, value: value, attributes: attributes});
                }
              };
            },
            createCounter: function createCounter(name) {
              return {
                add: function add(value, attributes) {
                  adds.push({name: name, value: value, attributes: attributes});
                }
              };
            },
            createUpDownCounter: function createUpDownCounter(name) {
              return {
                add: function add(value, attributes) {
                  adds.push({name: name, value: value, attributes: attributes});
                }
              };
            }
          };
        }
      }
    },
    spans   : spans,
    records : records,
    adds    : adds
  };
}

function publish(name, message) {
  Diagnostics.channel(name).publish(message);
}

function find(items, name) {
  return items.filter(function (item) {
    return item.name === name;
  })[0];
}

test('OpenTelemetry operational signals', {
  'classifies query errors and increments the error counter': function() {
    var telemetry = createApi();
    var adapter = createOpenTelemetryAdapter({api: telemetry.api}).enable();

    publish('nublox.mysql.query.start', {operation: 'query', threadId: 41});
    publish('nublox.mysql.query.error', {
      operation  : 'query',
      threadId   : 41,
      durationMs : 3,
      errorCode  : 'ER_LOCK_DEADLOCK',
      errno      : 1213
    });

    adapter.disable();

    var errorMetric = find(telemetry.adds, 'db.client.operation.errors');
    assert.ok(errorMetric);
    assert.strictEqual(errorMetric.value, 1);
    assert.strictEqual(errorMetric.attributes['nublox.mysql.error.category'], 'deadlock');
    assert.strictEqual(errorMetric.attributes['error.type'], 'ER_LOCK_DEADLOCK');
    assert.strictEqual(telemetry.spans[0].attributes['nublox.mysql.error.category'], 'deadlock');
  },

  'records transaction retries with bounded attributes': function() {
    var telemetry = createApi();
    var adapter = createOpenTelemetryAdapter({api: telemetry.api}).enable();

    publish('nublox.mysql.transaction.retry', {
      attempt   : 2,
      delayMs   : 50,
      errorCode : 'ER_LOCK_WAIT_TIMEOUT',
      errno     : 1205
    });

    adapter.disable();

    var retryMetric = find(telemetry.adds, 'db.client.operation.retries');
    assert.ok(retryMetric);
    assert.strictEqual(retryMetric.value, 1);
    assert.strictEqual(retryMetric.attributes['db.operation.name'], 'transaction');
    assert.strictEqual(retryMetric.attributes['nublox.mysql.error.category'], 'lock_timeout');
    assert.strictEqual(retryMetric.attributes['nublox.mysql.retry.attempt'], 2);
    assert.strictEqual(retryMetric.attributes['nublox.mysql.retry.delay_ms'], 50);
  },

  'emits privacy-safe slow-query diagnostics and span events': function() {
    var telemetry = createApi();
    var observed = [];
    var listener = function listener(message) {
      observed.push(message);
    };
    var channel = Diagnostics.channel('nublox.mysql.query.slow');
    channel.subscribe(listener);

    var adapter = createOpenTelemetryAdapter({
      api                  : telemetry.api,
      database             : 'orders',
      slowQueryThresholdMs : 100
    }).enable();

    publish('nublox.mysql.query.start', {
      operation : 'query',
      sql       : 'SELECT private_value FROM secrets',
      threadId  : 42
    });
    publish('nublox.mysql.query.end', {
      operation  : 'query',
      sql        : 'SELECT private_value FROM secrets',
      threadId   : 42,
      durationMs : 125
    });

    adapter.disable();
    channel.unsubscribe(listener);

    assert.strictEqual(observed.length, 1);
    assert.strictEqual(observed[0].durationMs, 125);
    assert.strictEqual(observed[0].thresholdMs, 100);
    assert.strictEqual(observed[0].sql, undefined);
    assert.strictEqual(telemetry.spans[0].events.length, 1);
    assert.strictEqual(telemetry.spans[0].events[0].name, 'db.client.slow_query');
    assert.strictEqual(
      telemetry.spans[0].events[0].attributes['nublox.mysql.slow.threshold_ms'],
      100
    );
  },

  'includes SQL in slow diagnostics only when query-text capture is enabled': function() {
    var telemetry = createApi();
    var observed = [];
    var listener = function listener(message) {
      observed.push(message);
    };
    var channel = Diagnostics.channel('nublox.mysql.query.slow');
    channel.subscribe(listener);

    var adapter = createOpenTelemetryAdapter({
      api                  : telemetry.api,
      captureQueryText     : true,
      slowQueryThresholdMs : 1
    }).enable();

    publish('nublox.mysql.query.start', {
      operation : 'query',
      sql       : 'SELECT 1',
      threadId  : 43
    });
    publish('nublox.mysql.query.end', {
      operation  : 'query',
      sql        : 'SELECT 1',
      threadId   : 43,
      durationMs : 2
    });

    adapter.disable();
    channel.unsubscribe(listener);

    assert.strictEqual(observed[0].sql, 'SELECT 1');
  },

  'does not emit slow-query signals below the threshold': function() {
    var telemetry = createApi();
    var observed = [];
    var listener = function listener(message) {
      observed.push(message);
    };
    var channel = Diagnostics.channel('nublox.mysql.query.slow');
    channel.subscribe(listener);

    var adapter = createOpenTelemetryAdapter({
      api                  : telemetry.api,
      slowQueryThresholdMs : 100
    }).enable();

    publish('nublox.mysql.query.start', {operation: 'query', threadId: 44});
    publish('nublox.mysql.query.end', {
      operation  : 'query',
      threadId   : 44,
      durationMs : 99.9
    });

    adapter.disable();
    channel.unsubscribe(listener);

    assert.strictEqual(observed.length, 0);
    assert.strictEqual(telemetry.spans[0].events.length, 0);
  },

  'validates slow-query thresholds': function() {
    var telemetry = createApi();

    assert.throws(function() {
      createOpenTelemetryAdapter({api: telemetry.api, slowQueryThresholdMs: -1});
    }, /slowQueryThresholdMs must be a non-negative finite number/);
  }
});
