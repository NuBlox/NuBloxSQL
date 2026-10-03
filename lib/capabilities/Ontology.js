'use strict';

var SCHEMA_VERSION = 1;

var SUPPORT_LEVELS = Object.freeze([
  'native', 'partial', 'emulated', 'unsupported', 'unknown', 'not-applicable'
]);
var AVAILABILITY_KINDS = Object.freeze([
  'unconditional', 'version-dependent', 'edition-dependent', 'deployment-dependent',
  'engine-dependent', 'connector-dependent', 'extension-dependent',
  'component-dependent', 'configuration-dependent'
]);
var MATURITY_LEVELS = Object.freeze([
  'stable', 'preview', 'experimental', 'deprecated', 'removed'
]);
var IMPLEMENTATION_LEVELS = Object.freeze([
  'implemented', 'partial', 'unsupported', 'not-applicable'
]);
var CAPABILITY_KINDS = Object.freeze([
  'syntax', 'semantic', 'datatype', 'object', 'constraint', 'security', 'transaction',
  'physical', 'operational', 'programmability', 'function', 'operator', 'extension'
]);
var PORTABILITY_LEVELS = Object.freeze([
  'standard', 'common', 'vendor-extension', 'vendor-specific', 'unclassified'
]);

var CATEGORY_KIND = Object.freeze({
  statements: 'syntax',
  queries: 'semantic',
  schema: 'object',
  expressions: 'semantic',
  integrity: 'constraint',
  physical: 'physical',
  security: 'security',
  transactions: 'transaction',
  programmability: 'programmability',
  administration: 'operational',
  dataMovement: 'operational',
  extensions: 'extension',
  types: 'datatype',
  functions: 'function',
  operators: 'operator',
  keywords: 'syntax',
  syntax: 'syntax',
  limits: 'operational'
});

var RELATIONSHIPS = Object.freeze({
  'queries.cte.recursive': Object.freeze({ requires: Object.freeze(['queries.cte.ordinary']) }),
  'queries.cte.search': Object.freeze({ requires: Object.freeze(['queries.cte.recursive']) }),
  'queries.cte.cycle': Object.freeze({ requires: Object.freeze(['queries.cte.recursive']) }),
  'queries.setOperators.unionAll': Object.freeze({ requires: Object.freeze(['queries.setOperators.union']) }),
  'queries.setOperators.intersectAll': Object.freeze({ requires: Object.freeze(['queries.setOperators.intersect']) }),
  'queries.setOperators.exceptAll': Object.freeze({ requires: Object.freeze(['queries.setOperators.except']) }),
  'queries.windows.named': Object.freeze({ requires: Object.freeze(['queries.windows.supported']) }),
  'queries.windows.rows': Object.freeze({ requires: Object.freeze(['queries.windows.supported']) }),
  'queries.windows.range': Object.freeze({ requires: Object.freeze(['queries.windows.supported']) }),
  'queries.windows.groups': Object.freeze({ requires: Object.freeze(['queries.windows.supported']) }),
  'queries.windows.exclude': Object.freeze({ requires: Object.freeze(['queries.windows.supported']) })
});

var COMPILER_FOUNDATION = Object.freeze({
  'statements.select': true,
  'queries.distinct.standard': true,
  'queries.joins.inner': true,
  'queries.joins.left': true,
  'queries.joins.right': true,
  'queries.joins.full': true,
  'queries.joins.cross': true,
  'queries.grouping.groupBy': true,
  'queries.grouping.having': true,
  'queries.ordering.orderBy': true,
  'queries.pagination.limit': true,
  'queries.pagination.offset': true
});

var COMPILER_QUERY_WAVE1 = Object.freeze({
  'queries.cte.ordinary': true,
  'queries.cte.recursive': true,
  'queries.subqueries.scalar': true,
  'queries.subqueries.correlated': true,
  'queries.subqueries.exists': true,
  'queries.subqueries.in': true,
  'queries.subqueries.derivedTables': true
});

var COMPILER_QUERY_WAVE2 = Object.freeze({
  'queries.setOperators.union': true,
  'queries.setOperators.unionAll': true,
  'queries.setOperators.intersect': true,
  'queries.setOperators.intersectAll': true,
  'queries.setOperators.except': true,
  'queries.setOperators.exceptAll': true
});

var COMPILER_QUERY_WAVE3 = Object.freeze({
  'expressions.caseExpression': true,
  'expressions.cast': true,
  'queries.windows.supported': true,
  'queries.windows.named': true,
  'queries.windows.rows': true,
  'queries.windows.range': true,
  'queries.windows.groups': true,
  'queries.windows.exclude': true
});

function humanize(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectFeaturePaths(core, object, prefix, out) {
  Object.keys(object || {}).forEach(function (key) {
    var value = object[key];
    var path = prefix ? prefix + '.' + key : key;
    if (core.isFeature(value)) out[path] = true;
    else if (value && typeof value === 'object' && !Array.isArray(value)) collectFeaturePaths(core, value, path, out);
  });
  return out;
}

function compareVersion(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return null;
  var a = left.match(/\d+/g);
  var b = right.match(/\d+/g);
  if (!a || !b) return null;
  var length = Math.max(a.length, b.length);
  for (var i = 0; i < length; i += 1) {
    var av = Number(a[i] || 0);
    var bv = Number(b[i] || 0);
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

function engineSupport(feature) {
  if (!feature) return 'unknown';
  if (feature.support === 'native' || feature.support === 'equivalent' || feature.support === 'runtime-dependent') return 'native';
  if (feature.support === 'partial') return 'partial';
  if (feature.support === 'emulated') return 'emulated';
  if (feature.support === 'unsupported') return 'unsupported';
  if (feature.support === 'not-applicable') return 'not-applicable';
  return 'unknown';
}

function availabilityKind(id, feature) {
  if (!feature) return 'unconditional';
  if (feature.support === 'runtime-dependent' && id.indexOf('extensions.') === 0) return 'extension-dependent';
  if (feature.since) return 'version-dependent';
  if (feature.support === 'runtime-dependent') return 'engine-dependent';
  return 'unconditional';
}

function maturity(feature) {
  return feature && feature.deprecatedSince ? 'deprecated' : 'stable';
}

function relationship(id) {
  var source = RELATIONSHIPS[id] || {};
  return Object.freeze({
    requires: Object.freeze((source.requires || []).slice()),
    implies: Object.freeze((source.implies || []).slice()),
    conflictsWith: Object.freeze((source.conflictsWith || []).slice()),
    relatedTo: Object.freeze((source.relatedTo || []).slice())
  });
}

function portability(core, models, id) {
  var present = 0;
  var standard = false;
  var vendorExtension = false;
  Object.keys(models).forEach(function (dialect) {
    var feature = core.getPath(models[dialect], id);
    if (!core.isFeature(feature)) return;
    if (feature.support !== 'unsupported' && feature.support !== 'not-applicable') present += 1;
    if (feature.standard) {
      if (/extension/i.test(String(feature.standard))) vendorExtension = true;
      else standard = true;
    }
  });
  if (standard) return 'standard';
  if (vendorExtension) return 'vendor-extension';
  if (present >= 2) return 'common';
  if (present === 1) return 'vendor-specific';
  return 'unclassified';
}

function definition(core, models, id) {
  var parts = id.split('.');
  var family = parts[0];
  var aliases = {};
  Object.keys(models).forEach(function (dialect) {
    var feature = core.getPath(models[dialect], id);
    if (!core.isFeature(feature)) return;
    (feature.aliases || []).forEach(function (alias) { aliases[alias] = true; });
  });
  return core.deepFreeze({
    id: id,
    family: family,
    name: humanize(parts[parts.length - 1]),
    kind: CATEGORY_KIND[family] || 'semantic',
    description: 'SQL capability: ' + humanize(id) + '.',
    portability: portability(core, models, id),
    aliases: Object.keys(aliases).sort(),
    relationships: relationship(id)
  });
}

function subject(model) {
  return Object.freeze({
    dialect: model.dialect,
    version: model.identity && model.identity.referenceVersion || null,
    edition: null,
    deployment: null,
    connector: null,
    extension: null
  });
}

function observation(core, model, id, feature) {
  var kind = availabilityKind(id, feature);
  var conditions = [];
  if (feature.since) conditions.push('since ' + feature.since);
  if (feature.deprecatedSince) conditions.push('deprecated since ' + feature.deprecatedSince);
  return core.deepFreeze({
    capabilityId: id,
    subject: subject(model),
    support: engineSupport(feature),
    maturity: maturity(feature),
    availability: { kind: kind, conditions: conditions },
    since: feature.since || null,
    until: null,
    syntax: {
      nativeName: feature.nativeName || null,
      canonical: feature.syntax || null,
      aliases: (feature.aliases || []).slice()
    },
    semantics: {
      equivalent: feature.support === 'equivalent',
      equivalentTo: (feature.equivalentTo || []).slice(),
      restrictions: (feature.restrictions || []).slice(),
      notes: feature.notes || null,
      standard: feature.standard || null
    },
    evidence: {
      classification: feature.evidence || 'documented',
      documentation: (feature.references || []).slice()
    },
    legacy: {
      path: id,
      support: feature.support,
      supported: feature.supported
    }
  });
}

function implementation(core, id) {
  var foundation = COMPILER_FOUNDATION[id] === true;
  var queryWave1 = COMPILER_QUERY_WAVE1[id] === true;
  var queryWave2 = COMPILER_QUERY_WAVE2[id] === true;
  var queryWave3 = COMPILER_QUERY_WAVE3[id] === true;
  var implemented = foundation || queryWave1 || queryWave2 || queryWave3;
  return core.deepFreeze({
    capabilityId: id,
    scope: foundation ? 'select-foundation-v1' : queryWave1 ? 'select-query-v2' : queryWave2 ? 'select-query-v3' : queryWave3 ? 'select-query-v4' : null,
    stages: {
      parser: implemented ? 'implemented' : 'unsupported',
      ast: implemented ? 'implemented' : 'unsupported',
      validator: implemented ? 'partial' : 'unsupported',
      renderer: implemented ? 'implemented' : 'unsupported',
      rewrite: implemented ? 'partial' : 'unsupported',
      runtime: 'not-applicable'
    },
    qualified: implemented,
    evidence: implemented ? [
      'test/sql-ast-compiler.js',
      'test/sql-capability-rewrite.js',
      'test/compiler-query-live.js',
      'tool/check-stable-release.js'
    ] : []
  });
}

function create(core, normalizeDialect, models) {
  var set = {};
  Object.keys(models).forEach(function (dialect) {
    core.CATEGORIES.forEach(function (category) {
      collectFeaturePaths(core, models[dialect][category], category, set);
    });
  });
  var ids = Object.freeze(Object.keys(set).sort());
  var definitions = {};
  var implementations = {};
  var observations = {};

  ids.forEach(function (id) {
    definitions[id] = definition(core, models, id);
    implementations[id] = implementation(core, id);
    observations[id] = {};
    Object.keys(models).forEach(function (dialect) {
      var feature = core.getPath(models[dialect], id);
      if (core.isFeature(feature)) observations[id][dialect] = observation(core, models[dialect], id, feature);
    });
    observations[id] = core.deepFreeze(observations[id]);
  });
  definitions = core.deepFreeze(definitions);
  implementations = core.deepFreeze(implementations);
  observations = core.deepFreeze(observations);

  function requireId(id) {
    if (typeof id !== 'string' || id.trim().length === 0) throw new TypeError('SQL capability ontology id must be a non-empty string');
    return id.trim();
  }

  function idsFor(options) {
    options = options || {};
    var family = options.family || null;
    var kind = options.kind || null;
    if (kind !== null && CAPABILITY_KINDS.indexOf(kind) === -1) throw new RangeError('Unknown SQL capability kind: ' + kind);
    return Object.freeze(ids.filter(function (id) {
      var item = definitions[id];
      if (family && item.family !== family) return false;
      if (kind && item.kind !== kind) return false;
      return true;
    }));
  }

  function getDefinition(id) {
    id = requireId(id);
    return definitions[id] || null;
  }

  function getObservation(dialectName, id) {
    id = requireId(id);
    var dialect = normalizeDialect(dialectName);
    return observations[id] && observations[id][dialect] || null;
  }

  function getObservations(id) {
    id = requireId(id);
    return observations[id] || core.deepFreeze({});
  }

  function getImplementation(id) {
    id = requireId(id);
    return implementations[id] || null;
  }

  function resolve(dialectName, id, context) {
    context = context || {};
    var entry = getObservation(dialectName, id);
    if (!entry) return null;
    var available;
    var reason;
    if (entry.support === 'unsupported' || entry.support === 'not-applicable') {
      available = false;
      reason = entry.support;
    } else if (entry.support === 'unknown') {
      available = null;
      reason = 'support-unknown';
    } else if (entry.availability.kind === 'unconditional') {
      available = true;
      reason = 'unconditional';
    } else if (entry.availability.kind === 'version-dependent' && context.version) {
      var sinceResult = entry.since ? compareVersion(String(context.version), entry.since) : 0;
      var untilResult = entry.until ? compareVersion(String(context.version), entry.until) : -1;
      if (sinceResult === null || untilResult === null) {
        available = null;
        reason = 'version-unparseable';
      } else {
        available = sinceResult >= 0 && (!entry.until || untilResult <= 0);
        reason = available ? 'version-satisfied' : 'version-outside-range';
      }
    } else {
      available = null;
      reason = 'qualification-required';
    }
    return core.deepFreeze({
      capabilityId: id,
      subject: entry.subject,
      support: entry.support,
      maturity: entry.maturity,
      availability: entry.availability,
      available: available,
      reason: reason,
      implementation: getImplementation(id)
    });
  }

  function profile(dialectName) {
    var dialect = normalizeDialect(dialectName);
    var entries = [];
    var summary = {
      total: 0,
      native: 0,
      partial: 0,
      emulated: 0,
      unsupported: 0,
      unknown: 0,
      notApplicable: 0,
      conditional: 0
    };
    ids.forEach(function (id) {
      var entry = observations[id][dialect];
      if (!entry) return;
      entries.push(entry);
      summary.total += 1;
      if (entry.support === 'native') summary.native += 1;
      else if (entry.support === 'partial') summary.partial += 1;
      else if (entry.support === 'emulated') summary.emulated += 1;
      else if (entry.support === 'unsupported') summary.unsupported += 1;
      else if (entry.support === 'not-applicable') summary.notApplicable += 1;
      else summary.unknown += 1;
      if (entry.availability.kind !== 'unconditional') summary.conditional += 1;
    });
    return core.deepFreeze({
      schemaVersion: SCHEMA_VERSION,
      dialect: dialect,
      subject: subject(models[dialect]),
      summary: summary,
      observations: entries
    });
  }

  function inventory(options) {
    options = options || {};
    var filteredIds = idsFor(options);
    var dialect = options.dialect === undefined ? null : normalizeDialect(options.dialect);
    return Object.freeze(filteredIds.map(function (id) {
      return core.deepFreeze({
        definition: definitions[id],
        observation: dialect ? observations[id][dialect] || null : null,
        implementation: implementations[id]
      });
    }));
  }

  function validate() {
    var observationCount = 0;
    ids.forEach(function (id) {
      if (!definitions[id] || definitions[id].id !== id) throw new Error('SQL capability ontology definition mismatch: ' + id);
      if (!implementations[id] || implementations[id].capabilityId !== id) throw new Error('SQL capability ontology implementation mismatch: ' + id);
      Object.keys(observations[id]).forEach(function (dialect) {
        var entry = observations[id][dialect];
        if (entry.capabilityId !== id) throw new Error('SQL capability ontology observation mismatch: ' + id);
        if (SUPPORT_LEVELS.indexOf(entry.support) === -1) throw new Error('Invalid ontology support state: ' + entry.support);
        if (AVAILABILITY_KINDS.indexOf(entry.availability.kind) === -1) throw new Error('Invalid ontology availability state: ' + entry.availability.kind);
        if (MATURITY_LEVELS.indexOf(entry.maturity) === -1) throw new Error('Invalid ontology maturity state: ' + entry.maturity);
        observationCount += 1;
      });
    });
    return core.deepFreeze({ valid: true, definitions: ids.length, observations: observationCount });
  }

  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    supportLevels: SUPPORT_LEVELS,
    availabilityKinds: AVAILABILITY_KINDS,
    maturityLevels: MATURITY_LEVELS,
    implementationLevels: IMPLEMENTATION_LEVELS,
    capabilityKinds: CAPABILITY_KINDS,
    portabilityLevels: PORTABILITY_LEVELS,
    ids: idsFor,
    definition: getDefinition,
    observation: getObservation,
    observations: getObservations,
    implementation: getImplementation,
    resolve: resolve,
    profile: profile,
    inventory: inventory,
    validate: validate
  });
}

exports.SCHEMA_VERSION = SCHEMA_VERSION;
exports.SUPPORT_LEVELS = SUPPORT_LEVELS;
exports.AVAILABILITY_KINDS = AVAILABILITY_KINDS;
exports.MATURITY_LEVELS = MATURITY_LEVELS;
exports.IMPLEMENTATION_LEVELS = IMPLEMENTATION_LEVELS;
exports.CAPABILITY_KINDS = CAPABILITY_KINDS;
exports.PORTABILITY_LEVELS = PORTABILITY_LEVELS;
exports.create = create;
exports.compareVersion = compareVersion;
