'use strict';

var assert = require('assert');
var sqlCore = require('../lib/core');
var mysql = require('../lib/dialects/mysql/lib/SqlDialectDescriptor');
var postgresqlPackage = require('../lib/dialects/postgresql');
var postgresql = postgresqlPackage.descriptor || postgresqlPackage;
var sqlitePackage = require('../lib/dialects/sqlite');
var sqlite = sqlitePackage.descriptor || sqlitePackage;
var sqlserverPackage = require('../lib/dialects/sqlserver');
var sqlserver = sqlserverPackage.descriptor || sqlserverPackage;

sqlCore.assertDialectDescriptor(mysql);
sqlCore.assertDialectDescriptor(postgresql);
sqlCore.assertDialectDescriptor(sqlite);
sqlCore.assertDialectDescriptor(sqlserver);

assert.strictEqual(mysql.identity.family, sqlCore.DIALECT_FAMILIES.MYSQL);
assert.strictEqual(postgresql.identity.family, sqlCore.DIALECT_FAMILIES.POSTGRESQL);
assert.strictEqual(sqlite.identity.family, sqlCore.DIALECT_FAMILIES.SQLITE);
assert.strictEqual(sqlserver.identity.family, sqlCore.DIALECT_FAMILIES.SQLSERVER);
assert.strictEqual(mysql.services.placeholder(1), '?');
assert.strictEqual(postgresql.services.placeholder(1), '$1');
assert.strictEqual(sqlite.services.placeholder(1), '?');
assert.strictEqual(sqlserver.services.placeholder(1), '@p1');
assert.strictEqual(mysql.supports(sqlCore.CAPABILITIES.SCHEMAS), false);
assert.strictEqual(postgresql.supports(sqlCore.CAPABILITIES.SCHEMAS), true);
assert.strictEqual(sqlite.supports(sqlCore.CAPABILITIES.SCHEMAS), false);
assert.strictEqual(sqlserver.supports(sqlCore.CAPABILITIES.SCHEMAS), false);
assert.strictEqual(sqlite.supports(sqlCore.CAPABILITIES.SAVEPOINTS), true);
assert.strictEqual(sqlserver.supports(sqlCore.CAPABILITIES.SAVEPOINTS), true);
assert.strictEqual(sqlserver.supports('transactions'), true);
assert.strictEqual(sqlserver.supports('nestedTransactions'), true);
assert.strictEqual(sqlserver.supports('transactionIsolation'), true);
assert.strictEqual(sqlserver.supports('readOnlyTransactions'), false);
assert.strictEqual(sqlserver.supports(sqlCore.CAPABILITIES.QUERY_CANCELLATION), true);
assert.strictEqual(sqlserver.supports(sqlCore.CAPABILITIES.PREPARED_STATEMENTS), false);
