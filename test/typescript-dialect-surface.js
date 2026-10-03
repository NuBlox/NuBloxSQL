'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var packageJson = require('../package.json');
assert.strictEqual(packageJson.types, 'types/root.d.ts');

var rootDeclarations = fs.readFileSync(path.join(__dirname, '..', 'types', 'root.d.ts'), 'utf8');
assert.ok(rootDeclarations.indexOf("export * from './public';") >= 0);
assert.ok(rootDeclarations.indexOf("export * from './portable-metadata';") >= 0);

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

var publicDeclarations = fs.readFileSync(path.join(__dirname, '..', 'types', 'public.d.ts'), 'utf8');
[
  'export type SqlCapabilityTier1Dialect',
  'export type SqlCapabilitySupportLevel',
  'export type SqlCapabilityCoverageLevel',
  'export interface SqlCapabilityFeature',
  'readonly deprecatedSince: string | null',
  'readonly standard: string | null',
  'readonly references: readonly string[]',
  'export interface SqlDialectCapabilityModel',
  'readonly coverage: SqlCapabilityCoverageLevel',
  'readonly evidenceRegister: readonly string[]',
  'export interface SqlCapabilityModelApi',
  'export interface SqlAstBetweenExpression',
  'export interface SqlAstTypeName',
  'export interface SqlAstCastExpression',
  'export interface SqlAstCaseBranch',
  'export interface SqlAstCaseExpression',
  'export interface SqlAstWindowFrameBound',
  'export interface SqlAstWindowFrame',
  'export interface SqlAstWindowSpecification',
  'export interface SqlAstWindowReference',
  'export interface SqlAstWindowExpression',
  'export interface SqlAstWindowDefinition',
  "'select-query-v4'",
  'readonly windows: readonly SqlAstWindowDefinition[]',
  'export const SQL_CAPABILITY_MODEL_SCHEMA_VERSION',
  'export const TIER1_DIALECTS',
  'export const capabilityModel'
].forEach(function (needle) {
  assert.ok(publicDeclarations.indexOf(needle) >= 0, 'missing capability model TypeScript contract: ' + needle);
});

var portableDeclarations = fs.readFileSync(path.join(__dirname, '..', 'types', 'portable-metadata.d.ts'), 'utf8');
[
  'export type PortableMetadataDialect',
  'export type PortableNullability',
  'export interface PortableColumnMetadata',
  'export interface PortableIndexMetadata',
  'export interface PortableForeignKeyMetadata',
  'export interface PortableConstraintMetadata',
  'export interface PortableTableMetadata',
  'export interface PortableMetadataSnapshot',
  'readonly vocabularyVersion: 1',
  'readonly portable: PortableMetadataSnapshot<D>'
].forEach(function (needle) {
  assert.ok(portableDeclarations.indexOf(needle) >= 0, 'missing portable metadata TypeScript contract: ' + needle);
});

var mysqlDeclarations = fs.readFileSync(path.join(__dirname, '..', 'lib', 'dialects', 'mysql', 'index.d.ts'), 'utf8');
[
  'export interface ExplainOptions',
  'export interface MySqlExplainSummary',
  'export interface MySqlExplainReport',
  'explain(sql: string',
  'explainAnalyze(sql: string',
  'diagnoseQuery(sql: string'
].forEach(function (needle) {
  assert.ok(mysqlDeclarations.indexOf(needle) >= 0, 'missing MySQL diagnostics TypeScript contract: ' + needle);
});

var postgresqlDeclarations = fs.readFileSync(path.join(__dirname, '..', 'lib', 'dialects', 'postgresql', 'index.d.ts'), 'utf8');
[
  'export interface PostgreSqlExplainOptions',
  'export interface PostgreSqlExplainSummary',
  'export interface PostgreSqlExplainReport',
  'explain(sql: string',
  'explainAnalyze(sql: string',
  'diagnoseQuery(sql: string'
].forEach(function (needle) {
  assert.ok(postgresqlDeclarations.indexOf(needle) >= 0, 'missing PostgreSQL diagnostics TypeScript contract: ' + needle);
});

console.log('NuBloxSQL TypeScript dialect discrimination, portable metadata and Wave 3 compiler surface contract passed');
