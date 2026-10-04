'use strict';

var assert = require('assert');
var sql = require('..');
var model = sql.capabilityModel;
var ontology = sql.capabilityOntology;

(function postgresqlCtasIsStructured() {
  var source = 'CREATE TABLE ledger_snapshot AS SELECT id, amount FROM ledger WHERE amount >= 0';
  var ast = model.parseSql('postgresql', source);
  assert.strictEqual(ast.type, 'CreateTableAsStatement');
  assert.strictEqual(ast.name.parts[0], 'ledger_snapshot');
  assert.strictEqual(ast.query.type, 'SelectStatement');
  assert.strictEqual(ast.ifNotExists, false);
  var analysis = model.analyzeAst(ast);
  assert.strictEqual(analysis.scope, 'ddl-v10');
  assert.ok(analysis.capabilities.indexOf('statements.createTableAs') !== -1);
  assert.ok(analysis.capabilities.indexOf('statements.select') !== -1);
  var result = model.transpileSql('postgresql', 'postgresql', source);
  assert.strictEqual(result.scope, 'ddl-v10');
  assert.strictEqual(result.certified, true);
  assert.ok(/^CREATE TABLE "ledger_snapshot" AS SELECT /.test(result.sql), result.sql);
})();

(function ctasExistsModifierAndQueryCompositionArePreserved() {
  var source = 'CREATE TABLE IF NOT EXISTS ledger_union AS SELECT id FROM current_ledger UNION ALL SELECT id FROM archived_ledger';
  ['postgresql','mysql','sqlite'].forEach(function (dialect) {
    var ast = model.parseSql(dialect, source);
    assert.strictEqual(ast.type, 'CreateTableAsStatement');
    assert.strictEqual(ast.ifNotExists, true);
    assert.strictEqual(ast.query.type, 'SetOperationStatement');
    var analysis = model.analyzeAst(ast);
    assert.strictEqual(analysis.scope, 'ddl-v10');
    assert.ok(analysis.capabilities.indexOf('syntax.existence.createTableIfNotExists') !== -1);
    assert.ok(analysis.capabilities.indexOf('queries.setOperators.unionAll') !== -1);
    var result = model.transpileSql(dialect, dialect, source);
    assert.strictEqual(result.certified, true);
    assert.ok(/CREATE TABLE IF NOT EXISTS/.test(result.sql), result.sql);
  });
})();

(function allTier1EnginesAdvertiseNativeCtas() {
  ['postgresql','mysql','sqlite'].forEach(function (dialect) {
    var feature = model.status(dialect, 'statements.createTableAs');
    assert.ok(feature, dialect);
    assert.strictEqual(feature.supported, true, dialect);
  });
})();

(function crossDialectCtasFailsClosed() {
  var source = 'CREATE TABLE ledger_snapshot AS SELECT id, amount FROM ledger';
  assert.throws(function () {
    model.transpileSql('postgresql', 'mysql', source);
  }, /result-schema\/type-normalisation/);
  assert.throws(function () {
    model.transpileSql('mysql', 'sqlite', source);
  }, /result-schema\/type-normalisation/);
})();

(function bindParametersAreRejected() {
  assert.throws(function () {
    model.parseSql('postgresql', 'CREATE TABLE ledger_snapshot AS SELECT $1 AS id');
  }, /cannot contain bind parameters/);
  assert.throws(function () {
    model.parseSql('mysql', 'CREATE TABLE ledger_snapshot AS SELECT ? AS id');
  }, /cannot contain bind parameters/);
  assert.throws(function () {
    model.parseSql('sqlite', 'CREATE TABLE ledger_snapshot AS SELECT ? AS id');
  }, /cannot contain bind parameters/);
})();

(function earlierCreateTableScopeRemainsIntact() {
  var ast = model.parseSql('postgresql', 'CREATE TABLE ledger (id INTEGER PRIMARY KEY)');
  assert.strictEqual(ast.type, 'CreateTableStatement');
  assert.strictEqual(model.analyzeAst(ast).scope, 'ddl-v1');
})();

(function ontologyCoverageIsExplicit() {
  var coverage = ontology.implementation('statements.createTableAs');
  assert.ok(coverage);
  assert.strictEqual(coverage.scope, 'ddl-v10');
  assert.strictEqual(coverage.qualified, true);
})();

console.log('NuBloxSQL Wave 5j CREATE TABLE AS contract: PASS');
