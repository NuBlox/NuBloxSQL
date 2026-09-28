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

  var api = {
    SpanKind       : {CLIENT: 2},
    SpanStatusCode : {ERROR: 2},
    context        : {
      active: function active() {
        return {name: 'active-context'};
      }
    },
    trace: {
      getTracer: function getTracer() {
        return {
          startSpan: function startSpan(name, options, context) {
            var span = {};
            span.name = name;
            span.options = options;
            span.context = context;
            span.attributes = {};
            span.status = null;
            span.ended = false;
            span.setAttributes = function setAttributes(attributes) {
              Object.assign(this.attributes, attributes);
            };
            span.setStatus = function setStatus(status) {
              this.status = status;
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
          createHistogram: function createHistogram(name, options) {
            return {
              name    : name,
              options : options,
              record  : function record(value, attributes) {
                records.push({value: value, attributes: attributes});
              }
            };
          }
        };
      }
    }
  };

  return {api: api, spans: spans, records: records};
}

function publish(channelName, message) {
  Diagnostics.channel(channelName).publish(message);
}

test('OpenTelemetry adapter', {
  'creates client spans without SQL text by default': function() {
    var telemetry = createApi();
    var adapter = createOpenTelemetryAdapter({
      api      : telemetry.api,
      database : 'orders',
      host     : 'db.internal',
      port     : 3306
    }).enable();

    publish('nublox.mysql.query.start', {
      operation : 'query',
      sql       : 'SELECT secret FROM users',
      threadId  : 7
    });
    publish('nublox.mysql.query.end', {
      operation  : 'query',
      sql        : 'SELECT secret FROM users',
      threadId   : 7,
      durationMs : 12.5
    });

    adapter.disable();

    assert.strictEqual(telemetry.spans.length, 1);
    assert.strictEqual(telemetry.spans[0].name, 'query orders');
    assert.strictEqual(telemetry.spans[0].options.kind, 2);
    assert.strictEqual(telemetry.spans[0].options.attributes['db.system.name'], 'mysql');
    assert.strictEqual(telemetry.spans[0].options.attributes['db.namespace'], 'orders');
    assert.strictEqual(telemetry.spans[0].options.attributes['server.address'], 'db.internal');
    assert.strictEqual(telemetry.spans[0].options.attributes['server.port'], 3306);
    assert.strictEqual(telemetry.spans[0].options.attributes['db.query.text'], undefined);
    assert.strictEqual(telemetry.spans[0].ended, true);
    assert.strictEqual(telemetry.records.length, 1);
    assert.strictEqual(telemetry.records[0].value, 0.0125);
  },

  'captures SQL only when explicitly enabled': function() {
    var telemetry = createApi();
    var adapter = createOpenTelemetryAdapter({
      api              : telemetry.api,
      captureQueryText : true
    }).enable();

    publish('nublox.mysql.query.start', {
      operation : 'query',
      sql       : 'SELECT 1',
      threadId  : 8
    });
    publish('nublox.mysql.query.end', {
      operation  : 'query',
      sql        : 'SELECT 1',
      threadId   : 8,
      durationMs : 1
    });

    adapter.disable();
    assert.strictEqual(telemetry.spans[0].options.attributes['db.query.text'], 'SELECT 1');
  },

  'marks failed operations and records response status': function() {
    var telemetry = createApi();
    var adapter = createOpenTelemetryAdapter({api: telemetry.api}).enable();

    publish('nublox.mysql.query.start', {
      operation : 'query',
      threadId  : 9
    });
    publish('nublox.mysql.query.error', {
      operation  : 'query',
      threadId   : 9,
      durationMs : 4,
      errorCode  : 'ER_PARSE_ERROR',
      errno      : 1064
    });

    adapter.disable();

    assert.strictEqual(telemetry.spans[0].status.code, 2);
    assert.strictEqual(telemetry.spans[0].attributes['error.type'], 'ER_PARSE_ERROR');
    assert.strictEqual(telemetry.spans[0].attributes['db.response.status_code'], '1064');
    assert.strictEqual(telemetry.records[0].attributes['error.type'], 'ER_PARSE_ERROR');
  },

  'enable and disable are idempotent': function() {
    var telemetry = createApi();
    var adapter = createOpenTelemetryAdapter({api: telemetry.api});

    assert.strictEqual(adapter.isEnabled(), false);
    adapter.enable().enable();
    assert.strictEqual(adapter.isEnabled(), true);
    adapter.disable().disable();
    assert.strictEqual(adapter.isEnabled(), false);
  }
});
