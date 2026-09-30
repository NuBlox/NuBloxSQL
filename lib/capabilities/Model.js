'use strict';

var SCHEMA_VERSION = 1;
var TIER1_DIALECTS = Object.freeze(['postgresql', 'mysql', 'sqlite']);
var CATEGORIES = Object.freeze([
  'statements', 'queries', 'schema', 'expressions', 'integrity', 'physical',
  'security', 'transactions', 'programmability', 'administration', 'dataMovement',
  'extensions', 'types', 'functions', 'operators', 'keywords', 'syntax', 'limits'
]);
var SUPPORT_LEVELS = Object.freeze([
  'native', 'equivalent', 'emulated', 'partial', 'runtime-dependent',
  'unsupported', 'unknown', 'not-applicable'
]);
var COVERAGE_LEVELS = Object.freeze(['foundation', 'exhaustive-v1']);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
  return Object.freeze(value);
}

function feature(support, options) {
  if (SUPPORT_LEVELS.indexOf(support) === -1) throw new RangeError('Unknown SQL capability support level: ' + support);
  options = options || {};
  var supported = support === 'native' || support === 'equivalent' || support === 'emulated' || support === 'partial';
  if (support === 'runtime-dependent' || support === 'unknown') supported = null;
  if (support === 'unsupported' || support === 'not-applicable') supported = false;
  return deepFreeze({
    supported: supported,
    support: support,
    nativeName: options.nativeName || null,
    since: options.since || null,
    deprecatedSince: options.deprecatedSince || null,
    syntax: options.syntax || null,
    standard: options.standard || null,
    evidence: options.evidence || 'documented',
    references: Object.freeze((options.references || []).slice()),
    restrictions: Object.freeze((options.restrictions || []).slice()),
    aliases: Object.freeze((options.aliases || []).slice()),
    equivalentTo: Object.freeze((options.equivalentTo || []).slice()),
    notes: options.notes || null
  });
}

function validateModel(model) {
  if (!model || typeof model !== 'object') throw new TypeError('SQL capability model must be an object');
  if (TIER1_DIALECTS.indexOf(model.dialect) === -1) throw new RangeError('SQL capability model dialect must be a Tier-1 dialect');
  if (COVERAGE_LEVELS.indexOf(model.coverage) === -1) throw new RangeError('Unknown SQL capability coverage level: ' + model.coverage);
  CATEGORIES.forEach(function (category) {
    if (!model[category] || typeof model[category] !== 'object' || Array.isArray(model[category])) {
      throw new TypeError('SQL capability model is missing category: ' + category);
    }
  });
  return model;
}

function createModel(dialect, identity, categories, options) {
  options = options || {};
  var coverage = options.coverage || 'foundation';
  var model = {
    schemaVersion: SCHEMA_VERSION,
    dialect: dialect,
    tier: 1,
    coverage: coverage,
    identity: identity || {},
    categories: CATEGORIES,
    evidenceRegister: Object.freeze((options.evidenceRegister || []).slice())
  };
  CATEGORIES.forEach(function (category) { model[category] = (categories && categories[category]) || {}; });
  validateModel(model);
  return deepFreeze(model);
}

function getPath(object, path) {
  if (typeof path !== 'string' || path.trim().length === 0) throw new TypeError('SQL capability path must be a non-empty string');
  var parts = path.split('.');
  var value = object;
  for (var i = 0; i < parts.length; i += 1) {
    if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, parts[i])) return undefined;
    value = value[parts[i]];
  }
  return value;
}

function isFeature(value) {
  return !!(value && typeof value === 'object' && SUPPORT_LEVELS.indexOf(value.support) !== -1 && Object.prototype.hasOwnProperty.call(value, 'supported'));
}

exports.SCHEMA_VERSION = SCHEMA_VERSION;
exports.TIER1_DIALECTS = TIER1_DIALECTS;
exports.CATEGORIES = CATEGORIES;
exports.SUPPORT_LEVELS = SUPPORT_LEVELS;
exports.COVERAGE_LEVELS = COVERAGE_LEVELS;
exports.feature = feature;
exports.createModel = createModel;
exports.validateModel = validateModel;
exports.getPath = getPath;
exports.isFeature = isFeature;
exports.deepFreeze = deepFreeze;
