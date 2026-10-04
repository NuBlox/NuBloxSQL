'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var rootDeclarations = fs.readFileSync(path.join(root, 'types', 'root.d.ts'), 'utf8');
assert.ok(rootDeclarations.indexOf("export * from './ddl';") >= 0, 'root declarations must export DDL types');
var ddl = fs.readFileSync(path.join(root, 'types', 'ddl.d.ts'), 'utf8');
[
  'export interface SqlAstForeignKeyReference','export interface SqlAstGeneratedColumn','export interface SqlAstIdentityColumn','export interface SqlAstColumnDefinition','export interface SqlAstPrimaryKeyConstraint','export interface SqlAstUniqueConstraint','export interface SqlAstCheckConstraint','export interface SqlAstForeignKeyConstraint','export type SqlAstTableConstraint',
  'export type SqlDropDependencyMode',
  'export interface SqlCreateTableStatementAst','export interface SqlCreateIndexStatementAst','export interface SqlCreateViewStatementAst','export interface SqlCreateSchemaStatementAst','export interface SqlCreateSequenceStatementAst',
  'export interface SqlDropTableStatementAst','export interface SqlDropViewStatementAst','export interface SqlDropIndexStatementAst','export interface SqlDropSchemaStatementAst','export interface SqlDropSequenceStatementAst',
  'readonly generated?: SqlAstGeneratedColumn','readonly identity?: SqlAstIdentityColumn','readonly ifNotExists?: boolean','readonly ifExists?: boolean','readonly concurrently?: boolean','readonly dependencyMode?: SqlDropDependencyMode',
  'export interface SqlAlterTableAddColumnActionAst','export interface SqlAlterTableDropColumnActionAst','export interface SqlAlterTableRenameColumnActionAst','export interface SqlAlterTableRenameTableActionAst','export interface SqlAlterColumnTypeActionAst','export interface SqlSetColumnDefaultActionAst','export interface SqlDropColumnDefaultActionAst','export interface SqlSetColumnNotNullActionAst','export interface SqlDropColumnNotNullActionAst','export interface SqlAddConstraintActionAst','export interface SqlDropConstraintActionAst','export type SqlAlterTableActionAst','export interface SqlAlterTableStatementAst','export type SqlDdlAst',
  "export type SqlDdlCompilerScope = 'ddl-v1' | 'ddl-v2' | 'ddl-v3' | 'ddl-v4' | 'ddl-v5' | 'ddl-v6'"
].forEach(function (needle) { assert.ok(ddl.indexOf(needle) >= 0, 'missing Wave 5 DDL TypeScript contract: ' + needle); });
var dml = fs.readFileSync(path.join(root, 'types', 'dml.d.ts'), 'utf8');
assert.ok(dml.indexOf("import type { SqlDdlAst, SqlDdlCompilerScope } from './ddl';") >= 0);
assert.ok(dml.indexOf('export type SqlStatementAst = SqlQueryAst | SqlDmlAst | SqlDdlAst;') >= 0);
assert.ok(dml.indexOf('SqlCompilerScope | SqlDmlCompilerScope | SqlDdlCompilerScope') >= 0);
console.log('NuBloxSQL Wave 5 DDL TypeScript surface contract passed');
