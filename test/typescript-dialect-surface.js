'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var packageJson = require('../package.json');
assert.strictEqual(packageJson.types, 'types/index.d.ts');

var declarations = fs.readFileSync(path.join(__dirname, '..', 'types', 'index.d.ts'), 'utf8');
[
  'export type CanonicalDialect',
  'export type DialectAdapter',
  'export type DialectConnection',
  'export type DialectPool',
  'export type DialectConnectionConfig',
  'export type DialectClientConfig',
  'export type DialectNative',
  'export type DialectClient',
  'export type MySqlClient',
  'export type PostgreSqlClient',
  'export type SqliteClient',
  'export type SqlServerClient',
  "function createClient(url: MySqlConnectionUrl",
  "function createClient(url: PostgreSqlConnectionUrl",
  "function createClient(url: SqliteConnectionUrl",
  "function createClient(url: SqlServerConnectionUrl",
  "function createClient(config: mysql.ConnectionConfig & { dialect: 'mysql'",
  "function createClient(config: postgresql.PostgreSqlConnectionOptions & { dialect: 'postgresql' | 'postgres' | 'pg'",
  "function createClient(config: sqlite.SQLiteConnectionOptions & { dialect: 'sqlite'",
  "function createClient(config: sqlserver.SqlServerConnectionConfig & { dialect: 'sqlserver' | 'mssql' | 'sql-server'",
  'function createConnection<D extends root.DialectAlias>',
  "function createPool<D extends Exclude<root.DialectAlias, 'sqlite'>>",
  'function capabilityReport<D extends root.DialectAlias>',
  'function transactionPolicy<D extends root.DialectAlias>'
].forEach(function (needle) {
  assert.ok(declarations.indexOf(needle) >= 0, 'missing TypeScript contract: ' + needle);
});

assert.ok(/readonly dialect: CanonicalDialect<D>/.test(declarations));
assert.ok(/readonly adapter: DialectAdapter<D>/.test(declarations));
assert.ok(/readonly native: DialectNative<D>/.test(declarations));
assert.ok(/transaction<T>\(fn: \(transaction: DialectClient<D>\)/.test(declarations));
assert.ok(/SqlServerConnectionConfig[\s\S]*pool\?: boolean \| root\.ClientPoolOptions/.test(declarations));
assert.ok(/CanonicalDialect<D> extends 'sqlite' \? false : boolean \| root\.ClientPoolOptions/.test(declarations));

console.log('NuBloxSQL TypeScript dialect discrimination surface contract passed');
