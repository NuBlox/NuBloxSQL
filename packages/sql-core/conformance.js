'use strict';

var core = require('./index');

var REQUIRED_CAPABILITIES = Object.freeze(Object.keys(core.CAPABILITIES).map(function mapCapability(key) {
  return core.CAPABILITIES[key];
}));

function issue(code, capability, message) {
  return Object.freeze({
    code       : code,
    capability : capability,
    message    : message
  });
}

function assessDialectDescriptor(descriptor) {
  var issues = [];

  try {
    core.assertDialectDescriptor(descriptor);
  } catch (error) {
    return Object.freeze([issue('invalid-descriptor', null, error.message)]);
  }

  if (!descriptor.capabilityProfile || typeof descriptor.capabilityProfile !== 'object') {
    issues.push(issue('missing-capability-profile', null, 'Production dialects require capabilityProfile'));
    return Object.freeze(issues);
  }

  if (typeof descriptor.capability !== 'function') {
    issues.push(issue('missing-capability-resolver', null, 'Production dialects require capability()'));
    return Object.freeze(issues);
  }

  REQUIRED_CAPABILITIES.forEach(function assessCapability(capabilityName) {
    var entry = descriptor.capabilityProfile[capabilityName];
    if (!entry) {
      issues.push(issue('missing-capability', capabilityName, 'Capability is not explicitly classified'));
      return;
    }

    var normalized;
    try {
      normalized = core.createCapabilityProfile((function createSingle() {
        var value = {};
        value[capabilityName] = entry;
        return value;
      }()))[capabilityName];
    } catch (error) {
      issues.push(issue('invalid-capability', capabilityName, error.message));
      return;
    }

    if (normalized.level === core.CAPABILITY_LEVELS.UNKNOWN) {
      issues.push(issue('unknown-capability', capabilityName, 'Production capability classification cannot be unknown'));
    }

    if (normalized.level === core.CAPABILITY_LEVELS.CONDITIONAL &&
        (!normalized.requires || normalized.requires.length === 0) && !normalized.notes) {
      issues.push(issue('undocumented-conditional', capabilityName, 'Conditional capability requires prerequisites or explanatory notes'));
    }

    var expectedSupport = normalized.level === core.CAPABILITY_LEVELS.NATIVE ||
      normalized.level === core.CAPABILITY_LEVELS.EMULATED ||
      normalized.level === core.CAPABILITY_LEVELS.CONDITIONAL;

    if (descriptor.supports(capabilityName) !== expectedSupport) {
      issues.push(issue('support-profile-mismatch', capabilityName, 'supports() disagrees with capability profile'));
    }
  });

  return Object.freeze(issues);
}

function assertProductionDialectDescriptor(descriptor) {
  var issues = assessDialectDescriptor(descriptor);
  if (issues.length > 0) {
    var summary = issues.map(function summarize(entry) {
      return entry.code + (entry.capability ? ':' + entry.capability : '') + ' - ' + entry.message;
    }).join('; ');
    var error = new Error('SQL dialect production conformance failed: ' + summary);
    error.name = 'SqlDialectConformanceError';
    error.issues = issues;
    throw error;
  }
  return descriptor;
}

exports.REQUIRED_CAPABILITIES = REQUIRED_CAPABILITIES;
exports.assessDialectDescriptor = assessDialectDescriptor;
exports.assertProductionDialectDescriptor = assertProductionDialectDescriptor;
