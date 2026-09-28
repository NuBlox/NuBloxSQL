'use strict';

var assert = require('assert');
var sqlCore = require('..');

var descriptor = sqlCore.createDialectDescriptor({
  identity : {
    family : sqlCore.DIALECT_FAMILIES.POSTGRESQL,
    name : 'PostgreSQL'
  },
  capabilities : {
    preparedStatements : true,
    schemas : true
  },
  services : {
    quoteIdentifier : function quoteIdentifier(identifier) {
      return '"' + identifier.replace(/"/g, '""') + '"';
    },
    placeholder : function placeholder(index) {
      return '$' + String(index);
    }
  }
});

assert.strictEqual(descriptor.identity.family, 'postgresql');
assert.strictEqual(descriptor.supports(sqlCore.CAPABILITIES.PREPARED_STATEMENTS), true);
assert.strictEqual(descriptor.supports(sqlCore.CAPABILITIES.SERVER_SIDE_CURSORS), false);
assert.strictEqual(descriptor.services.quoteIdentifier('a"b'), '"a""b"');
assert.strictEqual(descriptor.services.placeholder(2), '$2');
assert.deepStrictEqual(sqlCore.createObjectName({
  catalog : 'app',
  schema : 'public',
  name : 'users'
}), {
  catalog : 'app',
  schema : 'public',
  name : 'users'
});

assert.throws(function invalidCapability() {
  sqlCore.createDialectDescriptor({
    identity : {family : 'test', name : 'Test'},
    capabilities : {preparedStatements : 'yes'},
    services : descriptor.services
  });
}, /boolean/);

assert.throws(function missingServices() {
  sqlCore.createDialectDescriptor({
    identity : {family : 'test', name : 'Test'},
    capabilities : {}
  });
}, /services/);
