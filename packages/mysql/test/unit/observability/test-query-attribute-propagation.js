'use strict';

var assert = require('assert');
var path = require('path');

var createOpenTelemetryAdapter = require(path.resolve(__dirname, '../../../otel'));
var QueryAttributes = require(path.resolve(__dirname, '../../../lib/QueryAttributes'));

var activeContext = {request: 'active'};
var injectedContexts = [];
var api = {
  context: {
    active: function active() {
      return activeContext;
    }
  },
  propagation: {
    inject: function inject(context, carrier, setter) {
      injectedContexts.push(context);
      setter.set(carrier, 'traceparent', '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01');
      setter.set(carrier, 'tracestate', 'vendor=value');
      setter.set(carrier, 'baggage', 'secret=value');
    }
  },
  trace: {
    getTracer: function getTracer() {
      return {
        startSpan: function startSpan() {
          return {
            setAttributes : function setAttributes() {},
            setStatus     : function setStatus() {},
            end           : function end() {}
          };
        }
      };
    }
  },
  metrics: {
    getMeter: function getMeter() {
      return {};
    }
  }
};

var adapter = createOpenTelemetryAdapter({api: api}).enable();

try {
  var attributes = QueryAttributes.capture({
    traceparent : 'explicit-parent',
    tenant      : 'alpha'
  }, 'query');

  assert.strictEqual(injectedContexts.length, 1);
  assert.strictEqual(injectedContexts[0], activeContext);
  assert.strictEqual(attributes.traceparent, 'explicit-parent');
  assert.strictEqual(attributes.tracestate, 'vendor=value');
  assert.strictEqual(attributes.tenant, 'alpha');
  assert.strictEqual(attributes.baggage, undefined);

  var automatic = QueryAttributes.capture(null, 'execute');
  assert.strictEqual(automatic.traceparent, '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01');
  assert.strictEqual(automatic.tracestate, 'vendor=value');
  assert.strictEqual(automatic.baggage, undefined);
} finally {
  adapter.disable();
}

var disabled = QueryAttributes.capture(null, 'query');
assert.deepStrictEqual(disabled, {});

assert.throws(function invalidContainer() {
  QueryAttributes.capture([], 'query');
}, /query attributes must be an object/);

assert.throws(function invalidUndefined() {
  QueryAttributes.capture({bad: undefined}, 'query');
}, function (error) {
  return error && error.code === 'QUERY_ATTRIBUTE_UNDEFINED_VALUE';
});

assert.throws(function invalidObject() {
  QueryAttributes.capture({bad: {nested: true}}, 'query');
}, function (error) {
  return error && error.code === 'QUERY_ATTRIBUTE_UNSUPPORTED_TYPE';
});
