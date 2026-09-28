'use strict';

var assert = require('assert');
var sqlCore = require('../packages/sql-core');
var mysql = require('../packages/mysql/lib/SqlDialectDescriptor');
var postgresql = require('../packages/postgresql');

sqlCore.assertDialectDescriptor(mysql);
sqlCore.assertDialectDescriptor(postgresql);

assert.strictEqual(mysql.identity.family, sqlCore.DIALECT_FAMILIES.MYSQL);
assert.strictEqual(postgresql.identity.family, sqlCore.DIALECT_FAMILIES.POSTGRESQL);
assert.strictEqual(mysql.services.placeholder(1), '?');
assert.strictEqual(postgresql.services.placeholder(1), '$1');
assert.strictEqual(mysql.supports(sqlCore.CAPABILITIES.SCHEMAS), false);
assert.strictEqual(postgresql.supports(sqlCore.CAPABILITIES.SCHEMAS), true);
