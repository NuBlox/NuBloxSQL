'use strict';

var assert = require('assert');
var sqlCore = require('../../sql-core');
var postgresql = require('..');

sqlCore.assertDialectDescriptor(postgresql.descriptor);

assert.strictEqual(postgresql.descriptor.identity.family, 'postgresql');
assert.strictEqual(postgresql.descriptor.identity.name, 'PostgreSQL');
assert.strictEqual(postgresql.services.quoteIdentifier('user'), '"user"');
assert.strictEqual(postgresql.services.quoteIdentifier('a"b'), '"a""b"');
assert.strictEqual(postgresql.services.placeholder(1), '$1');
assert.strictEqual(postgresql.services.placeholder(12), '$12');
assert.throws(function invalidPlaceholder() {
  postgresql.services.placeholder(0);
}, RangeError);
assert.strictEqual(postgresql.descriptor.supports(sqlCore.CAPABILITIES.SCHEMAS), true);
assert.strictEqual(postgresql.descriptor.supports(sqlCore.CAPABILITIES.TRANSACTIONAL_DDL), true);
assert.deepStrictEqual(postgresql.createObjectName({
  catalog : 'appdb',
  schema  : 'public',
  name    : 'users'
}), {
  catalog : 'appdb',
  schema  : 'public',
  name    : 'users'
});
