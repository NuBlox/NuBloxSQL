'use strict';

var assert = require('assert');
var sqlCore = require('../packages/sql-core');
var mysql = require('../packages/mysql/lib/SqlDialectDescriptor');
var postgresqlPackage = require('../packages/postgresql');
var postgresql = postgresqlPackage.descriptor || postgresqlPackage;

sqlCore.assertDialectDescriptor(mysql);
sqlCore.assertDialectDescriptor(postgresql);

assert.strictEqual(mysql.identity.family, sqlCore.DIALECT_FAMILIES.MYSQL);
assert.strictEqual(postgresql.identity.family, sqlCore.DIALECT_FAMILIES.POSTGRESQL);
assert.strictEqual(mysql.services.placeholder(1), '?');
assert.strictEqual(postgresql.services.placeholder(1), '$1');
assert.strictEqual(mysql.supports(sqlCore.CAPABILITIES.SCHEMAS), false);
assert.strictEqual(postgresql.supports(sqlCore.CAPABILITIES.SCHEMAS), true);

function assertAdvancedProfile(name, descriptor) {
  assert.ok(descriptor.capabilityProfile, name + ' must expose capabilityProfile');
  assert.strictEqual(typeof descriptor.capability, 'function', name + ' must expose capability()');

  Object.keys(descriptor.capabilities).forEach(function assertLegacyCapabilityMapped(capabilityName) {
    var entry = descriptor.capability(capabilityName);
    assert.ok(entry, name + ' capability profile missing ' + capabilityName);
    assert.ok(Object.values(sqlCore.CAPABILITY_LEVELS).indexOf(entry.level) !== -1, name + ' capability has invalid level: ' + capabilityName);
    assert.strictEqual(descriptor.supports(capabilityName), entry.level !== sqlCore.CAPABILITY_LEVELS.UNSUPPORTED && entry.level !== sqlCore.CAPABILITY_LEVELS.UNKNOWN,
      name + ' boolean/profile support mismatch for ' + capabilityName);
  });

  [
    sqlCore.CAPABILITIES.CONNECTION_POOLING,
    sqlCore.CAPABILITIES.TLS,
    sqlCore.CAPABILITIES.PREPARED_STATEMENTS,
    sqlCore.CAPABILITIES.STREAMING_RESULTS,
    sqlCore.CAPABILITIES.QUERY_CANCELLATION,
    sqlCore.CAPABILITIES.SAVEPOINTS,
    sqlCore.CAPABILITIES.TRANSACTION_ISOLATION,
    sqlCore.CAPABILITIES.NATIVE_JSON,
    sqlCore.CAPABILITIES.SESSION_STATE,
    sqlCore.CAPABILITIES.EXPLAIN
  ].forEach(function assertReleaseGateCapability(capabilityName) {
    assert.ok(descriptor.capabilityProfile[capabilityName], name + ' release-gate profile missing ' + capabilityName);
  });
}

assertAdvancedProfile('MySQL', mysql);
assertAdvancedProfile('PostgreSQL', postgresql);

assert.strictEqual(mysql.capability(sqlCore.CAPABILITIES.TRANSACTIONAL_DDL).level, sqlCore.CAPABILITY_LEVELS.UNSUPPORTED);
assert.strictEqual(postgresql.capability(sqlCore.CAPABILITIES.TRANSACTIONAL_DDL).level, sqlCore.CAPABILITY_LEVELS.NATIVE);
assert.strictEqual(mysql.capability(sqlCore.CAPABILITIES.CHANGE_DATA_CAPTURE).level, sqlCore.CAPABILITY_LEVELS.CONDITIONAL);
assert.strictEqual(postgresql.capability(sqlCore.CAPABILITIES.CHANGE_DATA_CAPTURE).level, sqlCore.CAPABILITY_LEVELS.CONDITIONAL);
