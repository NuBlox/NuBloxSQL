'use strict';

var assert = require('assert');
var sqlCore = require('..');

var descriptor = sqlCore.createDialectDescriptor({
  identity: {
    family : sqlCore.DIALECT_FAMILIES.POSTGRESQL,
    name   : 'PostgreSQL'
  },
  capabilities: {
    preparedStatements : true,
    schemas            : true
  },
  services: {
    quoteIdentifier: function quoteIdentifier(identifier) {
      return '"' + identifier.replace(/"/g, '""') + '"';
    },
    placeholder: function placeholder(index) {
      return '$' + String(index);
    }
  }
});

assert.strictEqual(descriptor.identity.family, 'postgresql');
assert.strictEqual(descriptor.supports(sqlCore.CAPABILITIES.PREPARED_STATEMENTS), true);
assert.strictEqual(descriptor.supports(sqlCore.CAPABILITIES.SERVER_SIDE_CURSORS), false);
assert.strictEqual(descriptor.capability(sqlCore.CAPABILITIES.PREPARED_STATEMENTS).level, sqlCore.CAPABILITY_LEVELS.NATIVE);
assert.strictEqual(descriptor.capability(sqlCore.CAPABILITIES.SERVER_SIDE_CURSORS).level, sqlCore.CAPABILITY_LEVELS.UNKNOWN);
assert.strictEqual(descriptor.services.quoteIdentifier('a"b'), '"a""b"');
assert.strictEqual(descriptor.services.placeholder(2), '$2');
assert.deepStrictEqual(sqlCore.createObjectName({
  catalog : 'app',
  schema  : 'public',
  name    : 'users'
}), {
  catalog : 'app',
  schema  : 'public',
  name    : 'users'
});

var advanced = sqlCore.createDialectDescriptor({
  identity: {
    family: sqlCore.DIALECT_FAMILIES.MYSQL,
    name: 'MySQL',
    serverVersion: '9.7',
    edition: 'Community'
  },
  capabilityProfile: {
    preparedStatements: {level: 'native', since: '4.1'},
    streamingResults: {level: 'native'},
    returning: {level: 'unsupported', notes: 'Use generated-key semantics where applicable'},
    changeDataCapture: {level: 'conditional', requires: ['binary-log'], notes: 'Requires server configuration'},
    namedParameters: {level: 'emulated'}
  },
  services: descriptor.services
});

assert.strictEqual(advanced.supports(sqlCore.CAPABILITIES.PREPARED_STATEMENTS), true);
assert.strictEqual(advanced.supports(sqlCore.CAPABILITIES.CHANGE_DATA_CAPTURE), true);
assert.strictEqual(advanced.supports(sqlCore.CAPABILITIES.RETURNING), false);
assert.strictEqual(advanced.capability(sqlCore.CAPABILITIES.CHANGE_DATA_CAPTURE).level, 'conditional');
assert.deepStrictEqual(advanced.capability(sqlCore.CAPABILITIES.CHANGE_DATA_CAPTURE).requires, ['binary-log']);
assert.strictEqual(advanced.identity.edition, 'Community');
assert.ok(Object.isFrozen(advanced.capabilityProfile));
assert.ok(Object.isFrozen(advanced.capability(sqlCore.CAPABILITIES.CHANGE_DATA_CAPTURE)));

var profile = sqlCore.createCapabilityProfile({
  savepoints: true,
  twoPhaseCommit: false,
  arrays: {level: 'conditional', requires: ['extension-x']}
});
var booleans = sqlCore.capabilityProfileToBooleanMap(profile);
assert.strictEqual(booleans.savepoints, true);
assert.strictEqual(booleans.twoPhaseCommit, false);
assert.strictEqual(booleans.arrays, true);

assert.throws(function invalidCapability() {
  sqlCore.createDialectDescriptor({
    identity     : {family: 'test', name: 'Test'},
    capabilities : {preparedStatements: 'yes'},
    services     : descriptor.services
  });
}, /boolean/);

assert.throws(function invalidCapabilityLevel() {
  sqlCore.createCapabilityProfile({preparedStatements: {level: 'magic'}});
}, /Invalid SQL capability level/);

assert.throws(function invalidRequirements() {
  sqlCore.createCapabilityProfile({changeDataCapture: {level: 'conditional', requires: 'binlog'}});
}, /requires must be an array/);

assert.throws(function missingServices() {
  sqlCore.createDialectDescriptor({
    identity     : {family: 'test', name: 'Test'},
    capabilities : {}
  });
}, /services/);
