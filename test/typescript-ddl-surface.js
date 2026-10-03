'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..');
var rootDeclarations = fs.readFileSync(path.join(root, 'types', 'root.d.ts'), 'utf8');
assert.ok(rootDeclarations.indexOf("export * from './ddl';") >= 0, 'root declarations must export DDL types');

var ddl = fs.readFileSync(path.join(root, 'types', 'ddl.d.ts'), 'utf8');
[
  'export interface SqlAstForeignKeyReference',
  'export interface SqlAstColumnDefinition',
  'export interface SqlAstPrimaryKeyConstraint',
  'export interface SqlAstUniqueConstraint',
  'export interface SqlAstCheckConstraint',
  'export interface SqlAstForeignKeyConstraint',
  'export type SqlAstTableConstraint',
  'export interface SqlCreateTableStatementAst',
  'export interface SqlCreateIndexStatementAst',
  'export interface SqlCreateViewStatementAst',
  'export interface SqlCreateSchemaStatementAst',
  'export interface SqlCreateSequenceStatementAst',
  'export interface SqlDropTableStatementAst',
  'export interface SqlDropViewStatementAst',
  'export type SqlDdlAst',
  "export type SqlDdlCompilerScope = 'ddl-v1'"
].forEach(function (needle) {
  assert.ok(ddl.indexOf(needle) >= 0, 'missing Wave 5 DDL TypeScript contract: ' + needle);
});

var dml = fs.readFileSync(path.join(root, 'types', 'dml.d.ts'), 'utf8');
assert.ok(dml.indexOf("import type { SqlDdlAst, SqlDdlCompilerScope } from './ddl';") >= 0);
assert.ok(dml.indexOf('export type SqlStatementAst = SqlQueryAst | SqlDmlAst | SqlDdlAst;') >= 0);
assert.ok(dml.indexOf('SqlCompilerScope | SqlDmlCompilerScope | SqlDdlCompilerScope') >= 0);

console.log('NuBloxSQL Wave 5 DDL TypeScript surface contract passed');
