'use strict';

var IMPLEMENTED_CAPABILITIES = Object.freeze({
  'statements.insert': 'dml-v1',
  'statements.update': 'dml-v1',
  'statements.delete': 'dml-v1',
  'syntax.returning': 'dml-v1',
  'syntax.conflictHandling': 'dml-v2',
  'statements.merge': 'dml-v2',
  'statements.createTable': 'ddl-v1',
  'statements.createIndex': 'ddl-v1',
  'statements.createView': 'ddl-v1',
  'statements.createSchema': 'ddl-v1',
  'statements.createSequence': 'ddl-v1',
  'statements.dropTable': 'ddl-v1',
  'statements.dropView': 'ddl-v1',
  'integrity.notNull': 'ddl-v1',
  'integrity.check': 'ddl-v1',
  'integrity.unique': 'ddl-v1',
  'integrity.primaryKey': 'ddl-v1',
  'integrity.foreignKey': 'ddl-v1',
  'schema.uniqueIndex': 'ddl-v1',
  'schema.partialIndex': 'ddl-v1',
  'schema.tableAlter.addColumn': 'ddl-v2',
  'schema.tableAlter.dropColumn': 'ddl-v2',
  'schema.tableAlter.renameColumn': 'ddl-v2',
  'schema.tableAlter.renameTable': 'ddl-v2',
  'schema.tableAlter.alterColumnType': 'ddl-v3',
  'schema.tableAlter.setDefault': 'ddl-v3',
  'schema.tableAlter.dropDefault': 'ddl-v3',
  'schema.tableAlter.setNotNull': 'ddl-v3',
  'schema.tableAlter.dropNotNull': 'ddl-v3',
  'schema.tableAlter.addConstraint': 'ddl-v3',
  'schema.tableAlter.dropConstraint': 'ddl-v3'
});

function implementation(id) {
  var scope = IMPLEMENTED_CAPABILITIES[id];
  var dmlSemantic = scope === 'dml-v2';
  var ddl = scope === 'ddl-v1';
  var ddlLifecycle = scope === 'ddl-v2';
  var ddlColumnConstraint = scope === 'ddl-v3';
  return Object.freeze({
    capabilityId: id,
    scope: scope,
    stages: Object.freeze({
      parser: 'implemented',
      ast: 'implemented',
      validator: ddl || ddlLifecycle || ddlColumnConstraint ? 'implemented' : 'partial',
      renderer: 'implemented',
      rewrite: 'partial',
      runtime: 'not-applicable'
    }),
    qualified: true,
    evidence: Object.freeze(ddlColumnConstraint ? [
      'test/sql-ast-wave5-column-constraints.js',
      'test/compiler-ddl-column-constraints-live.js',
      'tool/check-ddl-v3-release.js'
    ] : ddlLifecycle ? [
      'test/sql-ast-wave5-lifecycle.js',
      'test/compiler-ddl-lifecycle-live.js',
      'tool/check-ddl-v2-release.js'
    ] : ddl ? [
      'test/sql-ast-wave5.js',
      'test/compiler-ddl-live.js',
      'tool/check-ddl-v1-release.js'
    ] : dmlSemantic ? [
      'test/sql-ast-wave4-semantics.js',
      'test/compiler-query-live.js',
      'tool/check-dml-v2-release.js'
    ] : [
      'test/sql-ast-wave4.js',
      'test/compiler-query-live.js',
      'tool/check-stable-release.js'
    ])
  });
}

function create(base) {
  function getImplementation(id) {
    if (IMPLEMENTED_CAPABILITIES[id]) return implementation(id);
    return base.implementation(id);
  }

  function resolve(dialect, id, context) {
    var result = base.resolve(dialect, id, context);
    if (!result || !IMPLEMENTED_CAPABILITIES[id]) return result;
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
      if (!entry || !entry.definition || !IMPLEMENTED_CAPABILITIES[entry.definition.id]) return entry;
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
exports.IMPLEMENTED_CAPABILITIES = IMPLEMENTED_CAPABILITIES;
exports.DML_CAPABILITIES = IMPLEMENTED_CAPABILITIES;
