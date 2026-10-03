'use strict';

var DML_CAPABILITIES = Object.freeze({
  'statements.insert': 'dml-v1',
  'statements.update': 'dml-v1',
  'statements.delete': 'dml-v1',
  'syntax.returning': 'dml-v1',
  'syntax.conflictHandling': 'dml-v2',
  'statements.merge': 'dml-v2'
});

function implementation(id) {
  var scope = DML_CAPABILITIES[id];
  var semantic = scope === 'dml-v2';
  return Object.freeze({
    capabilityId: id,
    scope: scope,
    stages: Object.freeze({
      parser: 'implemented',
      ast: 'implemented',
      validator: 'partial',
      renderer: 'implemented',
      rewrite: 'partial',
      runtime: 'not-applicable'
    }),
    qualified: true,
    evidence: Object.freeze(semantic ? [
      'test/sql-ast-wave4-semantics.js',
      'test/compiler-query-live.js',
      'tool/check-stable-release.js'
    ] : [
      'test/sql-ast-wave4.js',
      'test/compiler-query-live.js',
      'tool/check-stable-release.js'
    ])
  });
}

function create(base) {
  function getImplementation(id) {
    if (DML_CAPABILITIES[id]) return implementation(id);
    return base.implementation(id);
  }

  function resolve(dialect, id, context) {
    var result = base.resolve(dialect, id, context);
    if (!result || !DML_CAPABILITIES[id]) return result;
    return Object.freeze({
      capabilityId: result.capabilityId,
      subject: result.subject,
      support: result.support,
      maturity: result.maturity,
      availability: result.availability,
      available: result.available,
      reason: result.reason,
      implementation: getImplementation(id)
    });
  }

  function inventory(options) {
    return Object.freeze(base.inventory(options).map(function (entry) {
      if (!entry || !entry.definition || !DML_CAPABILITIES[entry.definition.id]) return entry;
      return Object.freeze({
        definition: entry.definition,
        observation: entry.observation,
        implementation: getImplementation(entry.definition.id)
      });
    }));
  }

  return Object.freeze({
    schemaVersion: base.schemaVersion,
    supportLevels: base.supportLevels,
    availabilityKinds: base.availabilityKinds,
    maturityLevels: base.maturityLevels,
    implementationLevels: base.implementationLevels,
    capabilityKinds: base.capabilityKinds,
    portabilityLevels: base.portabilityLevels,
    ids: base.ids,
    definition: base.definition,
    observation: base.observation,
    observations: base.observations,
    implementation: getImplementation,
    resolve: resolve,
    profile: base.profile,
    inventory: inventory,
    validate: base.validate
  });
}

exports.create = create;
exports.DML_CAPABILITIES = DML_CAPABILITIES;