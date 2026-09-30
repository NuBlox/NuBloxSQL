'use strict';

var assert = require('assert');
var sql = require('..');

assert.strictEqual(sql.SQL_CAPABILITY_MODEL_SCHEMA_VERSION, 1);
assert.deepStrictEqual(Array.from(sql.TIER1_DIALECTS), ['postgresql', 'mysql', 'sqlite']);
assert.ok(sql.SQL_CAPABILITY_CATEGORIES.indexOf('statements') >= 0);
assert.ok(sql.SQL_CAPABILITY_CATEGORIES.indexOf('dataMovement') >= 0);
assert.ok(sql.SQL_CAPABILITY_CATEGORIES.indexOf('types') >= 0);
assert.ok(sql.SQL_CAPABILITY_SUPPORT_LEVELS.indexOf('runtime-dependent') >= 0);

['postgresql', 'mysql', 'sqlite'].forEach(function (dialect) {
  var capabilityModel = sql.capabilityModel.dialect(dialect);
  assert.strictEqual(capabilityModel.schemaVersion, 1);
  assert.strictEqual(capabilityModel.dialect, dialect);
  assert.strictEqual(capabilityModel.tier, 1);
  assert.strictEqual(capabilityModel.coverage, 'exhaustive-v1');
  sql.SQL_CAPABILITY_CATEGORIES.forEach(function (category) {
    assert.ok(capabilityModel[category] && typeof capabilityModel[category] === 'object', dialect + ' missing category ' + category);
  });
  assert.ok(capabilityModel.evidenceRegister.length >= 20, dialect + ' evidence register is too shallow');
  assert.ok(Object.isFrozen(capabilityModel.evidenceRegister));
  assert.ok(Object.isFrozen(capabilityModel));
});

assert.strictEqual(sql.capabilityModel.dialect('pg').dialect, 'postgresql');
assert.strictEqual(sql.capabilityModel.status('mysql', 'queries.joins.lateral').since, '8.0.14');
assert.strictEqual(sql.capabilityModel.status('sqlite', 'expressions.json').support, 'runtime-dependent');
assert.strictEqual(sql.capabilityModel.get('postgresql', 'schema.materializedView').supported, true);
assert.strictEqual(sql.capabilityModel.get('mysql', 'schema.materializedView').supported, false);
assert.strictEqual(sql.capabilityModel.get('sqlite', 'schema.materializedView').supported, false);

var postgresAssertions = {
  'statements.merge': 'native', 'queries.cte.search': 'native', 'schema.partialIndex': 'native',
  'expressions.jsonTable': 'native', 'integrity.exclusion': 'native', 'physical.indexBRIN': 'native',
  'security.rowLevelSecurity': 'native', 'transactions.twoPhaseCommit': 'native', 'programmability.plpgsql': 'native',
  'administration.explainJson': 'native', 'dataMovement.logicalReplication': 'native', 'extensions.customAccessMethods': 'native',
  'types.multiranges': 'native', 'functions.orderedSetAggregate': 'native', 'operators.userDefined': 'native',
  'syntax.returningOldNew': 'native', 'limits.statementTimeout': 'native'
};
var mysqlAssertions = {
  'statements.replace': 'native', 'queries.joins.lateral': 'native', 'queries.setOperators.exceptAll': 'native',
  'schema.functionalIndex': 'native', 'schema.multiValuedIndex': 'native', 'expressions.jsonTable': 'native',
  'integrity.generatedStored': 'native', 'physical.partitionedInnoDbForeignKeys': 'unsupported', 'security.roles': 'native',
  'transactions.xaTransactions': 'native', 'programmability.scheduledEvents': 'native', 'administration.explainAnalyze': 'native',
  'dataMovement.bulkLoad': 'native', 'extensions.pluginFramework': 'native', 'types.boolean': 'equivalent',
  'operators.nullSafeEquality': 'native', 'syntax.returning': 'unsupported', 'limits.maxAllowedPacket': 'native'
};
var sqliteAssertions = {
  'statements.attach': 'native',
  'statements.alterTable': 'partial',
  'queries.joins.right': 'runtime-dependent',
  'queries.cte.materializationHints': 'runtime-dependent',
  'queries.windows.groups': 'runtime-dependent',
  'schema.withoutRowidTable': 'runtime-dependent',
  'schema.strictTable': 'runtime-dependent',
  'schema.partialIndex': 'runtime-dependent',
  'schema.expressionIndex': 'runtime-dependent',
  'expressions.jsonb': 'runtime-dependent',
  'expressions.regex': 'equivalent',
  'integrity.foreignKey': 'runtime-dependent',
  'integrity.identity': 'equivalent',
  'physical.wal': 'native',
  'physical.storageEngines': 'not-applicable',
  'security.authorizer': 'runtime-dependent',
  'security.usersAndRoles': 'not-applicable',
  'transactions.immediate': 'native',
  'transactions.oneWriter': 'native',
  'programmability.scalarFunctions': 'equivalent',
  'administration.explainQueryPlan': 'native',
  'administration.integrityCheck': 'native',
  'dataMovement.changesets': 'runtime-dependent',
  'extensions.fts5': 'runtime-dependent',
  'extensions.virtualTables': 'native',
  'types.dynamicTyping': 'native',
  'types.strictAny': 'runtime-dependent',
  'functions.tableFunctions': 'partial',
  'operators.jsonOperators': 'runtime-dependent',
  'syntax.returning': 'runtime-dependent',
  'syntax.conflictHandling': 'native',
  'limits.resourceGovernance': 'equivalent'
};

function assertCapabilities(dialect, assertions) {
  Object.keys(assertions).forEach(function (path) {
    var entry = sql.capabilityModel.status(dialect, path);
    assert.ok(entry, 'missing ' + dialect + ' capability: ' + path);
    assert.strictEqual(entry.support, assertions[path], 'unexpected ' + dialect + ' support: ' + path);
    assert.ok(entry.references.length > 0, dialect + ' capability lacks evidence reference: ' + path);
  });
}
assertCapabilities('postgresql', postgresAssertions);
assertCapabilities('mysql', mysqlAssertions);
assertCapabilities('sqlite', sqliteAssertions);

assert.strictEqual(sql.capabilityModel.status('postgresql', 'integrity.generatedVirtual').since, '18');
assert.strictEqual(sql.capabilityModel.status('mysql', 'queries.joins.lateral').since, '8.0.14');
assert.strictEqual(sql.capabilityModel.status('sqlite', 'queries.joins.right').since, '3.39.0');
assert.strictEqual(sql.capabilityModel.status('sqlite', 'expressions.jsonb').since, '3.45.0');
assert.strictEqual(sql.capabilityModel.status('sqlite', 'schema.strictTable').since, '3.37.0');
assert.strictEqual(sql.capabilityModel.status('sqlite', 'syntax.returning').since, '3.35.0');
assert.strictEqual(sql.capabilityModel.status('sqlite', 'security.usersAndRoles').supported, false);
assert.strictEqual(sql.capabilityModel.status('sqlite', 'transactions.rowLocks').supported, false);

var lateral = sql.capabilityModel.compare('queries.joins.lateral');
assert.strictEqual(lateral.portable, false);
assert.strictEqual(lateral.determinate, true);
assert.strictEqual(lateral.dialects.postgresql.support, 'native');
assert.strictEqual(lateral.dialects.mysql.support, 'native');
assert.strictEqual(lateral.dialects.sqlite.support, 'unsupported');

var json = sql.capabilityModel.compare('expressions.json');
assert.strictEqual(json.portable, false);
assert.strictEqual(json.determinate, false);
assert.strictEqual(json.dialects.sqlite.supported, null);

assert.strictEqual(sql.capabilityModel.get('postgresql', 'not.real'), undefined);
assert.strictEqual(sql.capabilityModel.status('postgresql', 'not.real'), null);
assert.strictEqual(sql.capabilityModel.supports('postgresql', 'not.real'), false);
assert.throws(function () { sql.capabilityModel.dialect('sqlserver'); }, /Tier-1 dialects/);
assert.throws(function () { sql.capabilityModel.get('postgresql', ''); }, /non-empty/);

console.log('NuBloxSQL Tier-1 PostgreSQL, MySQL and SQLite exhaustive-v1 capability contracts: PASS');
