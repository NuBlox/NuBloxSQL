'use strict';

var DML_CAPABILITIES = Object.freeze({
  'statements.insert': true,
  'statements.update': true,
  'statements.delete': true,
  'syntax.returning': true
});

function implementation(id) {
  return Object.freeze({
    capabilityId: id,
    scope: 'dml-v1',
    stages: Object.freeze({
      parser: 'implemented',
      ast: 'implemented',
      validator: 'partial',
      renderer: 'implemented',
      rewrite: 'partial',
      runtime: 'not-applicable'
    }),
    qualified: true,
    evidence: Object.freeze([
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
