'use strict';

var assert = require('assert');
var sql = require('..');
var model = sql.capabilityModel;
var ontology = sql.capabilityOntology;

(function postgresqlAdvancedIndexIsStructured() {
  var source = 'CREATE INDEX ledger_search_idx ON ledger USING btree ((lower(code))) INCLUDE (id)';
  var ast = model.parseSql('postgresql', source);
  assert.strictEqual(ast.type, 'CreateIndexStatement');
  assert.strictEqual(ast.method, 'btree');
  assert.strictEqual(ast.keys.length, 1);
  assert.strictEqual(ast.keys[0].type, 'IndexExpressionKey');
  assert.strictEqual(ast.keys[0].family, 'expression');
  assert.strictEqual(ast.include.length, 1);
  var analysis = model.analyzeAst(ast);
  assert.strictEqual(analysis.scope, 'ddl-v8');
  assert.ok(analysis.capabilities.indexOf('schema.expressionIndex') !== -1);
  assert.ok(analysis.capabilities.indexOf('schema.coveringIndex') !== -1);
  assert.ok(analysis.capabilities.indexOf('schema.indexAccessMethod') !== -1);
  var result = model.transpileSql('postgresql', 'postgresql', source);
  assert.strictEqual(result.certified, true);
  assert.ok(/USING btree/.test(result.sql), result.sql);
  assert.ok(/INCLUDE \("id"\)/.test(result.sql), result.sql);
  assert.ok(/\(\(lower\("code"\)\)\)/i.test(result.sql), result.sql);
})();

(function sqliteExpressionIndexesRequireRuntimeVersion() {
  var source = 'CREATE INDEX ledger_lower_idx ON ledger ((lower(code)))';
  assert.throws(function () { model.transpileSql('sqlite', 'sqlite', source); }, /runtime qualification/);
  var runtime = model.qualify('sqlite', { version:'3.49.1', source:'ddl-v8-static-test' });
  var result = model.transpileSql('sqlite', 'sqlite', source, { sourceQualification:runtime, targetQualification:runtime });
  assert.strictEqual(result.certified, true);
  assert.strictEqual(result.scope, 'ddl-v8');
  assert.ok(result.capabilities.indexOf('schema.expressionIndex') !== -1);
})();

(function mysqlFunctionalKeyPartsAreDistinct() {
  var source = 'CREATE INDEX ledger_lower_idx ON ledger ((lower(code)))';
  var ast = model.parseSql('mysql', source);
  assert.strictEqual(ast.keys[0].family, 'functional');
  var analysis = model.analyzeAst(ast);
  assert.ok(analysis.capabilities.indexOf('schema.functionalIndex') !== -1);
  assert.strictEqual(analysis.capabilities.indexOf('schema.expressionIndex'), -1);
  var result = model.transpileSql('mysql', 'mysql', source);
  assert.strictEqual(result.certified, true);
  assert.ok(/\(\(lower\(`code`\)\)\)/i.test(result.sql), result.sql);
})();

(function crossFamilyExpressionIndexesFailClosed() {
  var pg = 'CREATE INDEX ledger_lower_idx ON ledger ((lower(code)))';
  assert.throws(function () { model.transpileSql('postgresql', 'mysql', pg); }, /explicit semantic decision|functional index semantics/);
  var my = 'CREATE INDEX ledger_lower_idx ON ledger ((lower(code)))';
  assert.throws(function () { model.transpileSql('mysql', 'postgresql', my); }, /explicit semantic decision|functional key parts/);
})();

(function postgresqlPhysicalIndexOptionsFailClosed() {
  var include = 'CREATE INDEX ledger_cover_idx ON ledger (code) INCLUDE (id)';
  assert.strictEqual(model.transpileSql('postgresql', 'postgresql', include).certified, true);
  assert.throws(function () { model.transpileSql('postgresql', 'sqlite', include); }, /PostgreSQL-only|unsupported target capabilities/);
  var method = 'CREATE INDEX ledger_hash_idx ON ledger USING hash (code)';
  assert.strictEqual(model.transpileSql('postgresql', 'postgresql', method).certified, true);
  assert.throws(function () { model.transpileSql('postgresql', 'mysql', method); }, /PostgreSQL-only|unsupported target capabilities/);
  assert.throws(function () { model.parseSql('postgresql', 'CREATE INDEX ledger_bad_idx ON ledger USING imaginary (code)'); }, /built-in PostgreSQL index access methods/);
})();

(function ontologyCoverageIsExplicit() {
  ['schema.expressionIndex','schema.functionalIndex','schema.coveringIndex','schema.indexAccessMethod'].forEach(function (path) {
    var coverage = ontology.implementation(path);
    assert.ok(coverage, path);
    assert.strictEqual(coverage.scope, 'ddl-v8');
    assert.strictEqual(coverage.qualified, true);
  });
})();

console.log('NuBloxSQL Wave 5h advanced index semantic contract: PASS');
