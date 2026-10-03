'use strict';

var assert = require('assert');
var sql = require('..');
var model = sql.capabilityModel;
var ontology = sql.capabilityOntology;

(function concurrentCreateIndex() {
  var ast = model.parseSql('postgresql', 'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_ledger_id ON ledger (id) WHERE id > 0');
  assert.strictEqual(ast.type, 'CreateIndexStatement');
  assert.strictEqual(ast.concurrently, true);
  assert.strictEqual(ast.ifNotExists, true);
  var analysis = model.analyzeAst(ast);
  assert.strictEqual(analysis.scope, 'ddl-v5');
  assert.ok(analysis.capabilities.indexOf('schema.concurrentIndexBuild') !== -1);
  assert.ok(analysis.capabilities.indexOf('syntax.existence.createIndexIfNotExists') !== -1);
  var compiled = model.compileAst('postgresql', ast);
  assert.strictEqual(compiled.sql, 'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "idx_ledger_id" ON "ledger" ("id") WHERE ("id" > 0)');
  var same = model.transpileSql('postgresql', 'postgresql', 'CREATE INDEX CONCURRENTLY idx_ledger_id ON ledger (id)');
  assert.strictEqual(same.certified, true);
  assert.strictEqual(same.scope, 'ddl-v5');
})();

(function concurrentDropIndexAndDependency() {
  var ast = model.parseSql('postgresql', 'DROP INDEX CONCURRENTLY IF EXISTS idx_ledger_id RESTRICT');
  assert.strictEqual(ast.type, 'DropIndexStatement');
  assert.strictEqual(ast.concurrently, true);
  assert.strictEqual(ast.dependencyMode, 'restrict');
  var analysis = model.analyzeAst(ast);
  assert.ok(analysis.capabilities.indexOf('schema.concurrentIndexDrop') !== -1);
  assert.ok(analysis.capabilities.indexOf('syntax.dropDependency.restrict') !== -1);
  assert.strictEqual(model.compileAst('postgresql', ast).sql, 'DROP INDEX CONCURRENTLY IF EXISTS "idx_ledger_id" RESTRICT');
  assert.throws(function () {
    model.parseSql('postgresql', 'DROP INDEX CONCURRENTLY idx_ledger_id CASCADE');
  }, /cannot be combined with CASCADE/);
})();

(function dependencyBehavior() {
  var cascade = model.transpileSql('postgresql', 'postgresql', 'DROP TABLE IF EXISTS ledger CASCADE');
  assert.strictEqual(cascade.certified, true);
  assert.strictEqual(cascade.scope, 'ddl-v5');
  assert.strictEqual(cascade.sql, 'DROP TABLE IF EXISTS "ledger" CASCADE');
  assert.ok(cascade.capabilities.indexOf('syntax.dropDependency.cascade') !== -1);

  var restrict = model.parseSql('postgresql', 'DROP VIEW report_view RESTRICT');
  assert.strictEqual(restrict.dependencyMode, 'restrict');
  assert.strictEqual(model.compileAst('postgresql', restrict).sql, 'DROP VIEW "report_view" RESTRICT');
})();

(function failClosedCrossDialect() {
  assert.throws(function () {
    model.parseSql('mysql', 'CREATE INDEX CONCURRENTLY idx_x ON t (id)');
  }, /PostgreSQL source semantics/);
  assert.throws(function () {
    model.transpileSql('postgresql', 'mysql', 'CREATE INDEX CONCURRENTLY idx_x ON t (id)');
  }, /PostgreSQL-only/);
  assert.throws(function () {
    model.transpileSql('postgresql', 'sqlite', 'DROP TABLE t CASCADE');
  }, /PostgreSQL-only/);
})();

(function ontologyCoverage() {
  ['schema.concurrentIndexBuild', 'schema.concurrentIndexDrop', 'syntax.dropDependency.cascade', 'syntax.dropDependency.restrict'].forEach(function (path) {
    var coverage = ontology.implementation(path);
    assert.ok(coverage, path + ' implementation');
    assert.strictEqual(coverage.scope, 'ddl-v5');
    assert.strictEqual(coverage.stages.parser, 'implemented');
    assert.strictEqual(coverage.qualified, true);
  });
  assert.strictEqual(ontology.resolve('postgresql', 'schema.concurrentIndexDrop').available, true);
  assert.strictEqual(ontology.resolve('mysql', 'schema.concurrentIndexDrop').available, false);
  assert.strictEqual(ontology.resolve('sqlite', 'syntax.dropDependency.cascade').available, false);
})();

console.log('NuBloxSQL Wave 5e dependency/concurrent index contract: PASS');
