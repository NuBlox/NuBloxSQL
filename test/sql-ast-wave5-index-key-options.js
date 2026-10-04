'use strict';

var assert = require('assert');
var sql = require('..');
var model = sql.capabilityModel;
var ontology = sql.capabilityOntology;

(function postgresqlKeyOptionsAreStructured() {
  var source = 'CREATE INDEX ledger_code_idx ON ledger (code COLLATE "C" text_pattern_ops DESC NULLS LAST)';
  var ast = model.parseSql('postgresql', source);
  assert.strictEqual(ast.type, 'CreateIndexStatement');
  assert.strictEqual(ast.keys.length, 1);
  assert.strictEqual(ast.keys[0].type, 'IndexColumnKey');
  assert.strictEqual(ast.keys[0].direction, 'DESC');
  assert.strictEqual(ast.keys[0].collation.parts[0], 'C');
  assert.strictEqual(ast.keys[0].operatorClass.parts[0], 'text_pattern_ops');
  assert.strictEqual(ast.keys[0].nulls, 'LAST');
  var analysis = model.analyzeAst(ast);
  assert.strictEqual(analysis.scope, 'ddl-v9');
  ['schema.indexKeyOrder','schema.indexKeyCollation','schema.operatorClass','schema.indexNullsOrder'].forEach(function (path) {
    assert.ok(analysis.capabilities.indexOf(path) !== -1, path);
  });
  var result = model.transpileSql('postgresql', 'postgresql', source);
  assert.strictEqual(result.certified, true);
  assert.strictEqual(result.scope, 'ddl-v9');
  assert.ok(/COLLATE "C"/.test(result.sql), result.sql);
  assert.ok(/"text_pattern_ops" DESC NULLS LAST/.test(result.sql), result.sql);
})();

(function orderingIsPortableAcrossTier1() {
  var pg = model.transpileSql('postgresql', 'mysql', 'CREATE INDEX ledger_code_idx ON ledger (code DESC)');
  assert.strictEqual(pg.certified, true);
  assert.strictEqual(pg.scope, 'ddl-v9');
  assert.ok(/`code` DESC/.test(pg.sql), pg.sql);

  var my = model.transpileSql('mysql', 'sqlite', 'CREATE INDEX ledger_code_idx ON ledger (code ASC)');
  assert.strictEqual(my.certified, true);
  assert.ok(/"code" ASC/.test(my.sql), my.sql);
})();

(function sqliteCollationIsStructuredButEngineLocal() {
  var source = 'CREATE INDEX ledger_code_idx ON ledger (code COLLATE NOCASE DESC)';
  var ast = model.parseSql('sqlite', source);
  assert.strictEqual(ast.keys[0].collation.parts[0], 'NOCASE');
  assert.strictEqual(ast.keys[0].direction, 'DESC');
  assert.strictEqual(model.transpileSql('sqlite', 'sqlite', source).certified, true);
  assert.throws(function () {
    model.transpileSql('sqlite', 'postgresql', source);
  }, /collation identity requires an explicit semantic decision/);
})();

(function mysqlKeyCollationAndPostgresqlOnlyOptionsFailClosed() {
  assert.throws(function () {
    model.parseSql('mysql', 'CREATE INDEX ledger_code_idx ON ledger (code COLLATE utf8mb4_bin DESC)');
  }, /Key-level COLLATE|functional index key parts/);

  assert.throws(function () {
    model.transpileSql('postgresql', 'mysql', 'CREATE INDEX ledger_code_idx ON ledger (code NULLS FIRST)');
  }, /NULLS FIRST\/LAST|unsupported target capabilities/);

  assert.throws(function () {
    model.transpileSql('postgresql', 'sqlite', 'CREATE INDEX ledger_code_idx ON ledger (code text_pattern_ops)');
  }, /operator classes are PostgreSQL-only|unsupported target capabilities/);
})();

(function earlierIndexScopesRemainIntact() {
  assert.strictEqual(model.analyzeAst(model.parseSql('postgresql', 'CREATE INDEX ledger_code_idx ON ledger (code)')).scope, 'ddl-v1');
  assert.strictEqual(model.analyzeAst(model.parseSql('postgresql', 'CREATE INDEX CONCURRENTLY ledger_code_idx ON ledger (code)')).scope, 'ddl-v5');
  assert.strictEqual(model.analyzeAst(model.parseSql('postgresql', 'CREATE INDEX ledger_lower_idx ON ledger ((lower(code)))')).scope, 'ddl-v8');
})();

(function ontologyCoverageIsExplicit() {
  ['schema.indexKeyOrder','schema.indexKeyCollation','schema.indexNullsOrder','schema.operatorClass'].forEach(function (path) {
    var coverage = ontology.implementation(path);
    assert.ok(coverage, path);
    assert.strictEqual(coverage.scope, 'ddl-v9');
    assert.strictEqual(coverage.qualified, true);
  });
})();

console.log('NuBloxSQL Wave 5i index key option contract: PASS');
