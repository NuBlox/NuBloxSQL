'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var sqlCore = require('../packages/sql-core');
var mysql = require('../packages/mysql');
var mysqlDescriptor = require('../packages/mysql/lib/SqlDialectDescriptor');
var postgresql = require('../packages/postgresql');

function assertConnectionSurface(connection, family) {
  [
    'connect',
    'query',
    'prepare',
    'beginTransaction',
    'commit',
    'rollback',
    'withTransaction',
    'savepoint',
    'rollbackToSavepoint',
    'releaseSavepoint',
    'resetSession',
    'end',
    'destroy'
  ].forEach(function (name) {
    assert.strictEqual(typeof connection[name], 'function', family + ' missing Connection.' + name + '()');
  });
  assert.ok(Number.isInteger(connection.maxRows) && connection.maxRows > 0, family + ' must expose maxRows');
  assert.ok(Number.isInteger(connection.maxResultBytes) && connection.maxResultBytes > 0, family + ' must expose maxResultBytes');
  assert.ok(Number.isInteger(connection.maxRowBytes) && connection.maxRowBytes > 0, family + ' must expose maxRowBytes');
}

function assertPoolSurface(pool, family) {
  ['getConnection', 'releaseConnection', 'query', 'execute', 'withTransaction', 'end'].forEach(function (name) {
    assert.strictEqual(typeof pool[name], 'function', family + ' missing Pool.' + name + '()');
  });
}

assert.strictEqual(sqlCore.CONTRACT_VERSION, '1.0');
sqlCore.assertDialectDescriptor(mysqlDescriptor);
sqlCore.assertDialectDescriptor(postgresql.descriptor);

assert.strictEqual(mysqlDescriptor.identity.family, 'mysql');
assert.strictEqual(postgresql.descriptor.identity.family, 'postgresql');
assert.strictEqual(mysqlDescriptor.services.placeholder(1), '?');
assert.strictEqual(postgresql.services.placeholder(1), '$1');
assert.strictEqual(mysqlDescriptor.supports(sqlCore.CAPABILITIES.SCHEMAS), false);
assert.strictEqual(postgresql.descriptor.supports(sqlCore.CAPABILITIES.SCHEMAS), true);
assert.strictEqual(mysqlDescriptor.supports(sqlCore.CAPABILITIES.QUERY_CANCELLATION), false);
assert.strictEqual(postgresql.descriptor.supports(sqlCore.CAPABILITIES.QUERY_CANCELLATION), true);

var mysqlConnection = mysql.createConnection({ user: 'contract' });
var pgConnection = postgresql.createConnection({ user: 'contract' });
assertConnectionSurface(mysqlConnection, 'mysql');
assertConnectionSurface(pgConnection, 'postgresql');
assertPoolSurface(mysql.createPool({ user: 'contract' }), 'mysql');
assertPoolSurface(postgresql.createPool({ user: 'contract' }), 'postgresql');

assert.strictEqual(typeof mysql.MySqlResultLimitError, 'function');
assert.strictEqual(typeof postgresql.PostgreSqlResultLimitError, 'function');

var declaration = fs.readFileSync(path.join(__dirname, '..', 'packages', 'sql-core', 'index.d.ts'), 'utf8');
[
  'export interface SqlAbortSignal',
  'timeout?: number;',
  'export interface SqlResourceLimitOptions',
  'maxRows?: number;',
  'maxResultBytes?: number;',
  'maxRowBytes?: number;',
  'parameters?: readonly unknown[];',
  'affectedRows?: number | bigint;',
  "| 'state';",
  "export const CONTRACT_VERSION: '1.0';"
].forEach(function (token) {
  assert.ok(declaration.indexOf(token) !== -1, 'SQL Core v1 declaration missing: ' + token);
});

assert.strictEqual(declaration.indexOf('export interface SqlMultiResult'), -1, 'v1 must not freeze unproven generic multi-result abstraction');
assert.strictEqual(declaration.indexOf('deadline?: number | Date;'), -1, 'v1 core must not freeze MySQL-only absolute deadline option');
assert.strictEqual(declaration.indexOf('parameters?: readonly unknown[] | Readonly<Record<string, unknown>>;'), -1, 'v1 core must not freeze unproven named parameter map');

console.log('ok - SQL Core v1 contract proven by canonical MySQL and PostgreSQL adapters');
