'use strict';

var Diagnostics = require('diagnostics_channel');

var QueryAttributesChannel = Diagnostics.channel('nublox.mysql.query.attributes');
var ALLOWED_TRACE_KEYS = {
  traceparent : true,
  tracestate  : true
};

module.exports = createQueryAttributePropagation;

function createQueryAttributePropagation(options) {
  options = options || {};

  var api = options.api || loadOpenTelemetryApi();
  var enabled = false;

  function onQueryAttributes(message) {
    if (!message || !message.attributes ||
        !api.propagation || typeof api.propagation.inject !== 'function') {
      return;
    }

    var context = api.context && typeof api.context.active === 'function'
      ? api.context.active()
      : undefined;

    api.propagation.inject(context, message.attributes, {
      set: function set(carrier, key, value) {
        var normalized = String(key).toLowerCase();

        if (!ALLOWED_TRACE_KEYS[normalized] || hasOwn(carrier, normalized)) {
          return;
        }

        carrier[normalized] = String(value);
      }
    });
  }

  return {
    enable: function enable() {
      if (!enabled) {
        QueryAttributesChannel.subscribe(onQueryAttributes);
        enabled = true;
      }
      return this;
    },
    disable: function disable() {
      if (enabled) {
        QueryAttributesChannel.unsubscribe(onQueryAttributes);
        enabled = false;
      }
      return this;
    }
  };
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
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
