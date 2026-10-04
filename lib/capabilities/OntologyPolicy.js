'use strict';

var IMPLEMENTED_CAPABILITIES = Object.freeze({
  'statements.insert': 'dml-v1', 'statements.update': 'dml-v1', 'statements.delete': 'dml-v1', 'syntax.returning': 'dml-v1',
  'syntax.conflictHandling': 'dml-v2', 'statements.merge': 'dml-v2',
  'statements.createTable': 'ddl-v1', 'statements.createIndex': 'ddl-v1', 'statements.createView': 'ddl-v1',
  'statements.createSchema': 'ddl-v1', 'statements.createSequence': 'ddl-v1', 'statements.dropTable': 'ddl-v1', 'statements.dropView': 'ddl-v1',
  'integrity.notNull': 'ddl-v1', 'integrity.check': 'ddl-v1', 'integrity.unique': 'ddl-v1', 'integrity.primaryKey': 'ddl-v1', 'integrity.foreignKey': 'ddl-v1',
  'schema.uniqueIndex': 'ddl-v1', 'schema.partialIndex': 'ddl-v1',
  'schema.tableAlter.addColumn': 'ddl-v2', 'schema.tableAlter.dropColumn': 'ddl-v2', 'schema.tableAlter.renameColumn': 'ddl-v2', 'schema.tableAlter.renameTable': 'ddl-v2',
  'schema.tableAlter.alterColumnType': 'ddl-v3', 'schema.tableAlter.setDefault': 'ddl-v3', 'schema.tableAlter.dropDefault': 'ddl-v3',
  'schema.tableAlter.setNotNull': 'ddl-v3', 'schema.tableAlter.dropNotNull': 'ddl-v3', 'schema.tableAlter.addConstraint': 'ddl-v3', 'schema.tableAlter.dropConstraint': 'ddl-v3',
  'statements.dropIndex': 'ddl-v4', 'statements.dropSchema': 'ddl-v4', 'statements.dropSequence': 'ddl-v4',
  'syntax.existence.createTableIfNotExists': 'ddl-v4', 'syntax.existence.createIndexIfNotExists': 'ddl-v4',
  'syntax.existence.createSchemaIfNotExists': 'ddl-v4', 'syntax.existence.createSequenceIfNotExists': 'ddl-v4',
  'syntax.existence.dropTableIfExists': 'ddl-v4', 'syntax.existence.dropViewIfExists': 'ddl-v4',
  'syntax.existence.dropIndexIfExists': 'ddl-v4', 'syntax.existence.dropSchemaIfExists': 'ddl-v4', 'syntax.existence.dropSequenceIfExists': 'ddl-v4',
  'schema.concurrentIndexBuild': 'ddl-v5', 'schema.concurrentIndexDrop': 'ddl-v5',
  'syntax.dropDependency.cascade': 'ddl-v5', 'syntax.dropDependency.restrict': 'ddl-v5',
  'integrity.generatedColumns': 'ddl-v6', 'integrity.generatedStored': 'ddl-v6', 'integrity.generatedVirtual': 'ddl-v6',
  'integrity.identity': 'ddl-v6', 'integrity.identityAlways': 'ddl-v6', 'integrity.identityByDefault': 'ddl-v6',
  'schema.tableAlter.addForeignKey': 'ddl-v7',
  'integrity.matchSimple': 'ddl-v7', 'integrity.matchFull': 'ddl-v7', 'integrity.matchPartial': 'ddl-v7',
  'integrity.deferrableForeignKeys': 'ddl-v7', 'integrity.notDeferrableForeignKeys': 'ddl-v7',
  'integrity.initiallyDeferred': 'ddl-v7', 'integrity.initiallyImmediate': 'ddl-v7',
  'integrity.onDeleteCascade': 'ddl-v7', 'integrity.onDeleteSetNull': 'ddl-v7', 'integrity.onDeleteSetDefault': 'ddl-v7',
  'integrity.onDeleteRestrict': 'ddl-v7', 'integrity.onDeleteNoAction': 'ddl-v7',
  'integrity.onUpdateCascade': 'ddl-v7', 'integrity.onUpdateSetNull': 'ddl-v7', 'integrity.onUpdateSetDefault': 'ddl-v7',
  'integrity.onUpdateRestrict': 'ddl-v7', 'integrity.onUpdateNoAction': 'ddl-v7',
  'schema.expressionIndex': 'ddl-v8', 'schema.functionalIndex': 'ddl-v8', 'schema.coveringIndex': 'ddl-v8', 'schema.indexAccessMethod': 'ddl-v8'
});

function implementation(id) {
  var scope = IMPLEMENTED_CAPABILITIES[id];
  var ddl8 = scope === 'ddl-v8'; var ddl7 = scope === 'ddl-v7'; var ddl6 = scope === 'ddl-v6'; var ddl5 = scope === 'ddl-v5'; var ddl4 = scope === 'ddl-v4'; var ddl3 = scope === 'ddl-v3'; var ddl2 = scope === 'ddl-v2'; var ddl1 = scope === 'ddl-v1'; var dml2 = scope === 'dml-v2';
  return Object.freeze({
    capabilityId: id, scope: scope,
    stages: Object.freeze({ parser: 'implemented', ast: 'implemented', validator: ddl1 || ddl2 || ddl3 || ddl4 || ddl5 || ddl6 || ddl7 || ddl8 ? 'implemented' : 'partial', renderer: 'implemented', rewrite: 'partial', runtime: 'not-applicable' }),
    qualified: true,
    evidence: Object.freeze(ddl8 ? ['test/sql-ast-wave5-index-semantics.js','test/compiler-ddl-index-semantics-live.js','tool/check-ddl-v8-release.js'] : ddl7 ? ['test/sql-ast-wave5-foreign-keys.js','test/compiler-ddl-foreign-keys-live.js','tool/check-ddl-v7-release.js'] : ddl6 ? ['test/sql-ast-wave5-generated-identity.js','test/compiler-ddl-generated-identity-live.js','tool/check-ddl-v6-release.js'] : ddl5 ? ['test/sql-ast-wave5-dependency-concurrent.js','test/compiler-ddl-dependency-concurrent-live.js','tool/check-ddl-v5-release.js'] : ddl4 ? ['test/sql-ast-wave5-object-lifecycle.js','test/compiler-ddl-object-lifecycle-live.js','tool/check-ddl-v4-release.js'] : ddl3 ? ['test/sql-ast-wave5-column-constraints.js','test/compiler-ddl-column-constraints-live.js','tool/check-ddl-v3-release.js'] : ddl2 ? ['test/sql-ast-wave5-lifecycle.js','test/compiler-ddl-lifecycle-live.js','tool/check-ddl-v2-release.js'] : ddl1 ? ['test/sql-ast-wave5.js','test/compiler-ddl-live.js','tool/check-ddl-v1-release.js'] : dml2 ? ['test/sql-ast-wave4-semantics.js','test/compiler-query-live.js','tool/check-dml-v2-release.js'] : ['test/sql-ast-wave4.js','test/compiler-query-live.js','tool/check-stable-release.js'])
  });
}
function create(base) {
  function getImplementation(id) { return IMPLEMENTED_CAPABILITIES[id] ? implementation(id) : base.implementation(id); }
  function resolve(dialect, id, context) {
    var result = base.resolve(dialect, id, context); if (!result || !IMPLEMENTED_CAPABILITIES[id]) return result;
    return Object.freeze({ capabilityId: result.capabilityId, subject: result.subject, support: result.support, maturity: result.maturity, availability: result.availability, available: result.available, reason: result.reason, implementation: getImplementation(id) });
  }
  function inventory(options) { return Object.freeze(base.inventory(options).map(function (entry) { return entry && entry.definition && IMPLEMENTED_CAPABILITIES[entry.definition.id] ? Object.freeze({ definition: entry.definition, observation: entry.observation, implementation: getImplementation(entry.definition.id) }) : entry; })); }
  return Object.freeze({ schemaVersion: base.schemaVersion, supportLevels: base.supportLevels, availabilityKinds: base.availabilityKinds, maturityLevels: base.maturityLevels, implementationLevels: base.implementationLevels, capabilityKinds: base.capabilityKinds, portabilityLevels: base.portabilityLevels, ids: base.ids, definition: base.definition, observation: base.observation, observations: base.observations, implementation: getImplementation, resolve: resolve, profile: base.profile, inventory: inventory, validate: base.validate });
}
exports.create = create; exports.IMPLEMENTED_CAPABILITIES = IMPLEMENTED_CAPABILITIES; exports.DML_CAPABILITIES = IMPLEMENTED_CAPABILITIES;
