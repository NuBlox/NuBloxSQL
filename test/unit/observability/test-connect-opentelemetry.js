'use strict';

var assert = require('assert');
var Diagnostics = require('diagnostics_channel');
var path = require('path');

var createOpenTelemetryAdapter = require(path.resolve(__dirname, '../../../lib/OpenTelemetry'));

var spans = [];
var records = [];
var slow = [];
var api = {
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
            status     : null,
            ended      : false,
            events     : []
          };
          span.setAttributes = function setAttributes(attributes) {
            Object.assign(this.attributes, attributes);
          };
          span.setStatus = function setStatus(status) {
            this.status = status;
          };
          span.addEvent = function addEvent(name, attributes) {
            this.events.push({name: name, attributes: attributes});
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
        }
      };
    }
  }
};

var slowChannel = Diagnostics.channel('nublox.mysql.query.slow');
function onSlow(message) {
  slow.push(message);
}
slowChannel.subscribe(onSlow);

var adapter = createOpenTelemetryAdapter({
  api                  : api,
  database             : 'orders',
  slowQueryThresholdMs : 1
}).enable();

try {
  publish('nublox.mysql.query.start', {
    correlationId : 'connect:a',
    operation     : 'connect',
    threadId      : null
  });
  publish('nublox.mysql.query.start', {
    correlationId : 'connect:b',
    operation     : 'connect',
    threadId      : null
  });

  // Complete out of start order to prove correlation does not depend on
  // thread assignment or FIFO completion ordering.
  publish('nublox.mysql.query.end', {
    correlationId : 'connect:b',
    operation     : 'connect',
    threadId      : 22,
    durationMs    : 12
  });
  publish('nublox.mysql.query.error', {
    correlationId : 'connect:a',
    operation     : 'connect',
    threadId      : 11,
    durationMs    : 15,
    errorCode     : 'ETIMEDOUT'
  });

  assert.strictEqual(spans.length, 2);
  assert.strictEqual(spans[0].name, 'connect orders');
  assert.strictEqual(spans[1].name, 'connect orders');
  assert.strictEqual(spans[0].ended, true);
  assert.strictEqual(spans[1].ended, true);
  assert.strictEqual(spans[0].attributes['db.mysql.thread_id'], 11);
  assert.strictEqual(spans[1].attributes['db.mysql.thread_id'], 22);
  assert.strictEqual(spans[0].status.code, 2);
  assert.strictEqual(spans[0].attributes['error.type'], 'ETIMEDOUT');
  assert.strictEqual(spans[0].attributes['nublox.mysql.error.category'], 'timeout');
  assert.strictEqual(records.length, 2);
  assert.strictEqual(records[0].name, 'db.client.operation.duration');
  assert.strictEqual(records[1].name, 'db.client.operation.duration');
  assert.strictEqual(slow.length, 0);
} finally {
  adapter.disable();
  slowChannel.unsubscribe(onSlow);
}

function publish(name, message) {
  Diagnostics.channel(name).publish(message);
}
