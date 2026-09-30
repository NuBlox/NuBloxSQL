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
  assert.strictEqual(capabilityModel.coverage, dialect === 'postgresql' ? 'exhaustive-v1' : 'foundation');
  sql.SQL_CAPABILITY_CATEGORIES.forEach(function (category) {
    assert.ok(capabilityModel[category] && typeof capabilityModel[category] === 'object', dialect + ' missing category ' + category);
  });
  assert.ok(Object.isFrozen(capabilityModel));
});

var pg = sql.capabilityModel.dialect('postgresql');
assert.ok(Array.isArray(pg.evidenceRegister));
assert.ok(pg.evidenceRegister.length >= 20);
assert.ok(Object.isFrozen(pg.evidenceRegister));

assert.strictEqual(sql.capabilityModel.dialect('pg').dialect, 'postgresql');
assert.strictEqual(sql.capabilityModel.supports('postgresql', 'queries.joins.lateral'), true);
assert.strictEqual(sql.capabilityModel.status('postgresql', 'queries.joins.lateral').support, 'native');
assert.strictEqual(sql.capabilityModel.supports('mysql', 'queries.joins.lateral'), true);
assert.strictEqual(sql.capabilityModel.status('mysql', 'queries.joins.lateral').since, '8.0.14');
assert.strictEqual(sql.capabilityModel.supports('sqlite', 'queries.joins.lateral'), false);
assert.strictEqual(sql.capabilityModel.status('sqlite', 'expressions.json').support, 'runtime-dependent');
assert.strictEqual(sql.capabilityModel.get('postgresql', 'schema.materializedView').supported, true);
assert.strictEqual(sql.capabilityModel.get('mysql', 'schema.materializedView').supported, false);

var postgresAssertions = {
  'statements.merge': 'native',
  'queries.cte.search': 'native',
  'queries.cte.cycle': 'native',
  'queries.grouping.groupingSets': 'native',
  'queries.locking.skipLocked': 'native',
  'schema.securityInvokerView': 'native',
  'schema.partialIndex': 'native',
  'schema.foreignTable': 'native',
  'expressions.jsonTable': 'native',
  'expressions.aggregateFilter': 'native',
  'integrity.exclusion': 'native',
  'integrity.generatedVirtual': 'native',
  'integrity.temporalWithoutOverlaps': 'native',
  'physical.partitionHash': 'native',
  'physical.indexBRIN': 'native',
  'security.rowLevelSecurity': 'native',
  'security.restrictivePolicies': 'native',
  'transactions.twoPhaseCommit': 'native',
  'transactions.readUncommitted': 'equivalent',
  'programmability.plpgsql': 'native',
  'programmability.dynamicSql': 'native',
  'administration.explainJson': 'native',
  'administration.reindexConcurrently': 'native',
  'dataMovement.binaryFormat': 'native',
  'dataMovement.logicalReplication': 'native',
  'extensions.customAccessMethods': 'native',
  'types.multiranges': 'native',
  'types.serial': 'equivalent',
  'functions.orderedSetAggregate': 'native',
  'operators.userDefined': 'native',
  'keywords.reservedClassification': 'native',
  'syntax.returningOldNew': 'native',
  'limits.statementTimeout': 'native'
};
Object.keys(postgresAssertions).forEach(function (path) {
  var entry = sql.capabilityModel.status('postgresql', path);
  assert.ok(entry, 'missing PostgreSQL capability: ' + path);
  assert.strictEqual(entry.support, postgresAssertions[path], 'unexpected PostgreSQL support: ' + path);
  assert.ok(entry.references.length > 0, 'PostgreSQL capability lacks evidence reference: ' + path);
});
assert.strictEqual(sql.capabilityModel.status('postgresql', 'integrity.generatedVirtual').since, '18');
assert.strictEqual(sql.capabilityModel.status('postgresql', 'syntax.returningOldNew').since, '18');
assert.strictEqual(sql.capabilityModel.status('postgresql', 'physical.nativeSharding').supported, false);
assert.strictEqual(sql.capabilityModel.status('postgresql', 'security.dynamicDataMasking').supported, false);
assert.strictEqual(sql.capabilityModel.status('postgresql', 'transactions.autonomousTransactions').supported, false);

var lateral = sql.capabilityModel.compare('queries.joins.lateral');
assert.strictEqual(lateral.portable, false);
assert.strictEqual(lateral.determinate, true);
assert.strictEqual(lateral.dialects.postgresql.support, 'native');
assert.strictEqual(lateral.dialects.mysql.support, 'native');
assert.strictEqual(lateral.dialects.sqlite.support, 'unsupported');
assert.ok(Object.isFrozen(lateral));

var json = sql.capabilityModel.compare('expressions.json');
assert.strictEqual(json.portable, false);
assert.strictEqual(json.determinate, false);
assert.strictEqual(json.dialects.sqlite.supported, null);

assert.strictEqual(sql.capabilityModel.get('postgresql', 'not.real'), undefined);
assert.strictEqual(sql.capabilityModel.status('postgresql', 'not.real'), null);
assert.strictEqual(sql.capabilityModel.supports('postgresql', 'not.real'), false);
assert.throws(function () { sql.capabilityModel.dialect('sqlserver'); }, /Tier-1 dialects/);
assert.throws(function () { sql.capabilityModel.get('postgresql', ''); }, /non-empty/);

console.log('NuBloxSQL Tier-1 SQL capability model and PostgreSQL exhaustive-v1 contract: PASS');
