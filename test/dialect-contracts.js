'use strict';

var assert = require('assert');
var sqlCore = require('../packages/sql-core');
var mysql = require('../packages/mysql/lib/SqlDialectDescriptor');
var postgresqlPackage = require('../packages/postgresql');
var postgresql = postgresqlPackage.descriptor || postgresqlPackage;
var sqlitePackage = require('../packages/sqlite');
var sqlite = sqlitePackage.descriptor || sqlitePackage;

sqlCore.assertDialectDescriptor(mysql);
sqlCore.assertDialectDescriptor(postgresql);
sqlCore.assertDialectDescriptor(sqlite);

assert.strictEqual(mysql.identity.family, sqlCore.DIALECT_FAMILIES.MYSQL);
assert.strictEqual(postgresql.identity.family, sqlCore.DIALECT_FAMILIES.POSTGRESQL);
assert.strictEqual(sqlite.identity.family, sqlCore.DIALECT_FAMILIES.SQLITE);
assert.strictEqual(mysql.services.placeholder(1), '?');
assert.strictEqual(postgresql.services.placeholder(1), '$1');
assert.strictEqual(sqlite.services.placeholder(1), '?');
assert.strictEqual(mysql.supports(sqlCore.CAPABILITIES.SCHEMAS), false);
assert.strictEqual(postgresql.supports(sqlCore.CAPABILITIES.SCHEMAS), true);
assert.strictEqual(sqlite.supports(sqlCore.CAPABILITIES.SCHEMAS), false);
assert.strictEqual(sqlite.supports(sqlCore.CAPABILITIES.SAVEPOINTS), true);
