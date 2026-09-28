'use strict';

var createBaseAdapter = require('./lib/OpenTelemetry');
var createQueryAttributePropagation = require('./lib/OpenTelemetryQueryAttributes');

module.exports = createOpenTelemetryAdapter;
module.exports.createOpenTelemetryAdapter = createOpenTelemetryAdapter;

function createOpenTelemetryAdapter(options) {
  var adapter = createBaseAdapter(options);
  var propagation = createQueryAttributePropagation(options);
  var baseEnable = adapter.enable;
  var baseDisable = adapter.disable;

  adapter.enable = function enable() {
    propagation.enable();
    baseEnable.call(adapter);
    return adapter;
  };

  adapter.disable = function disable() {
    propagation.disable();
    baseDisable.call(adapter);
    return adapter;
  };

  return adapter;
}
