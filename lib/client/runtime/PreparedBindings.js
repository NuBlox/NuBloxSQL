'use strict';

const typedValues = require('../../core/TypedValue');

// SQL prepared-value and OID negotiation shared across the Client.
function resolvePreparedBindings(plan, bindings) {
  bindings = bindings || {};
  if (typeof bindings !== 'object' || Array.isArray(bindings)) {
    throw new TypeError('NuBloxSQL prepared statement bindings must be an object');
  }
  return plan.map(function (binding) {
    if (binding.kind === 'value') return binding.value;
    if (!Object.prototype.hasOwnProperty.call(bindings, binding.name)) {
      throw new RangeError('NuBloxSQL prepared statement is missing binding "' + binding.name + '"');
    }
    var value = bindings[binding.name];
    return binding.type ? typedValues.typed(value, binding.type) : value;
  });
}

function parameterTypeOids(compiled, services) {
  if (!services || typeof services.parameterTypeOid !== 'function' || !compiled || !Array.isArray(compiled.bindings)) return null;
  var hasTyped = false;
  var oids = compiled.bindings.map(function (binding) {
    if (!binding.type) return 0;
    hasTyped = true;
    return services.parameterTypeOid(binding.type);
  });
  return hasTyped ? oids : null;
}

function parameterTypeOidsFromValues(values, services) {
  if (!services || typeof services.parameterTypeOid !== 'function' || !Array.isArray(values)) return null;
  var hasTyped = false;
  var oids = values.map(function (value) {
    if (!typedValues.isTypedValue(value)) return 0;
    hasTyped = true;
    return services.parameterTypeOid(value.spec);
  });
  return hasTyped ? oids : null;
}

function bindParameters(values, services) {
  if (!Array.isArray(values) || !services || typeof services.bindParameter !== 'function') return values;
  return values.map(function (value, index) { return services.bindParameter(value, index); });
}

function operationOptionsForTypedValues(options, values, services) {
  var oids = parameterTypeOidsFromValues(values, services);
  if (!oids || (options && options.parameterTypeOids !== undefined)) return options || {};
  return Object.assign({}, options || {}, { parameterTypeOids: oids });
}

module.exports = Object.freeze({resolvePreparedBindings, parameterTypeOids, parameterTypeOidsFromValues, bindParameters, operationOptionsForTypedValues});
