'use strict';

var assert = require('assert');
var sqlCore = require('../../packages/sql-core');
var mysqlDescriptor = require('../../lib/SqlDialectDescriptor');

sqlCore.assertDialectDescriptor(mysqlDescriptor);

assert.strictEqual(mysqlDescriptor.identity.family, sqlCore.DIALECT_FAMILIES.MYSQL);
assert.strictEqual(mysqlDescriptor.supports(sqlCore.CAPABILITIES.PREPARED_STATEMENTS), true);
assert.strictEqual(mysqlDescriptor.supports(sqlCore.CAPABILITIES.SERVER_SIDE_CURSORS), true);
assert.strictEqual(mysqlDescriptor.supports(sqlCore.CAPABILITIES.SCHEMAS), false);
assert.strictEqual(mysqlDescriptor.services.quoteIdentifier('a`b'), '`a``b`');
assert.strictEqual(mysqlDescriptor.services.placeholder(1), '?');
