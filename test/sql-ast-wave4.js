'use strict';

var assert = require('assert');
var sql = require('..');
var model = sql.capabilityModel;
var ontology = sql.capabilityOntology;

(function insertValuesAndReturning() {
  var source = "INSERT INTO ledger (id, name, amount) VALUES ($1, $2, CASE WHEN $3 > 0 THEN CAST($3 AS DECIMAL(10,2)) ELSE 0 END), ($4, $5, $6) RETURNING id, name AS saved_name";
  var ast = model.parseSql('postgresql', source);
  assert.strictEqual(ast.type, 'InsertStatement');
  assert.deepStrictEqual(ast.target.parts, ['ledger']);
  assert.strictEqual(ast.columns.length, 3);
  assert.strictEqual(ast.rows.length, 2);
  assert.strictEqual(ast.rows[0][2].type, 'CaseExpression');
  assert.strictEqual(ast.returning.length, 2);
  assert.strictEqual(ast.returning[1].type, 'AliasedExpression');

  var analysis = model.analyzeAst(ast);
  assert.strictEqual(analysis.scope, 'dml-v1');
  ['statements.insert', 'syntax.returning', 'expressions.caseExpression', 'expressions.cast'].forEach(function (path) {
    assert.ok(analysis.capabilities.indexOf(path) !== -1, 'missing ' + path);
  });

  var compiled = model.compileAst('postgresql', ast);
  assert.ok(compiled.sql.indexOf('INSERT INTO "ledger" ("id", "name", "amount") VALUES') === 0);
  assert.ok(compiled.sql.indexOf('RETURNING "id", "name" AS "saved_name"') !== -1);
  assert.deepStrictEqual(compiled.targetToSource, [1, 2, 3, 4, 5, 6]);
})();

(function portableInsertParameterMapping() {
  var result = model.transpileSql('mysql', 'postgresql', 'INSERT INTO events (id, name) VALUES (?, ?), (?, ?)');
  assert.strictEqual(result.scope, 'dml-v1');
  assert.strictEqual(result.certified, true);
  assert.strictEqual(result.sql, 'INSERT INTO "events" ("id", "name") VALUES ($1, $2), ($3, $4)');
  assert.deepStrictEqual(result.targetToSource, [1, 2, 3, 4]);
})();

(function insertSelectComposition() {
  var result = model.transpileSql('postgresql', 'sqlite', 'INSERT INTO archive (id, name) SELECT id, name FROM source WHERE id > $1');
  assert.strictEqual(result.scope, 'dml-v1');
  assert.strictEqual(result.certified, true);
  assert.ok(result.capabilities.indexOf('statements.insert') !== -1);
  assert.ok(result.capabilities.indexOf('statements.select') !== -1);
  assert.strictEqual(result.sql, 'INSERT INTO "archive" ("id", "name") SELECT "id", "name" FROM "source" WHERE ("id" > ?1)');
  assert.deepStrictEqual(result.targetToSource, [1]);
})();

(function updateAndDelete() {
  var update = model.transpileSql('postgresql', 'mysql', 'UPDATE ledger SET amount = $1, name = CASE WHEN $2 = 1 THEN $3 ELSE name END WHERE id = $4');
  assert.strictEqual(update.scope, 'dml-v1');
  assert.strictEqual(update.certified, true);
  assert.strictEqual(update.sql, 'UPDATE `ledger` SET `amount` = ?, `name` = CASE WHEN (? = 1) THEN ? ELSE `name` END WHERE (`id` = ?)');
})();

(function updateParameterMappingUsesSourceBindings() {
  var update = model.transpileSql('postgresql', 'mysql', 'UPDATE ledger SET amount = $2, name = $1 WHERE id = $3');
  assert.strictEqual(update.certified, true);
  assert.deepStrictEqual(update.targetToSource, [2, 1, 3]);
  assert.strictEqual(update.sql, 'UPDATE `ledger` SET `amount` = ?, `name` = ? WHERE (`id` = ?)');

  var deletion = model.transpileSql('sqlite', 'postgresql', 'DELETE FROM ledger WHERE id = :id');
  assert.strictEqual(deletion.scope, 'dml-v1');
  assert.strictEqual(deletion.certified, true);
  assert.strictEqual(deletion.sql, 'DELETE FROM "ledger" WHERE ("id" = $1)');
  assert.deepStrictEqual(deletion.targetToSource, [':id']);
})();

(function returningCapabilityIsHonest() {
  assert.throws(function () {
    model.transpileSql('postgresql', 'mysql', 'DELETE FROM ledger WHERE id = $1 RETURNING id');
  }, /blocked by unsupported target capabilities/);

  assert.throws(function () {
    model.parseSql('mysql', 'DELETE FROM ledger WHERE id = ? RETURNING id');
  }, /RETURNING is not valid MySQL source syntax/);

  var sqliteQualification = model.qualify('sqlite', {
    version: '3.45.0',
    features: { 'syntax.returning': true },
    source: 'wave4-static-test'
  });
  var sqlite = model.transpileSql('postgresql', 'sqlite', 'DELETE FROM ledger WHERE id = $1 RETURNING id', {
    targetQualification: sqliteQualification
  });
  assert.strictEqual(sqlite.certified, true);
  assert.strictEqual(sqlite.sql, 'DELETE FROM "ledger" WHERE ("id" = ?1) RETURNING "id"');
})();

(function invalidDmlFailsClosed() {
  assert.throws(function () {
    model.parseSql('postgresql', 'INSERT INTO ledger (id, name) VALUES (1)');
  }, /width must match/);
  assert.throws(function () {
    model.parseSql('postgresql', 'UPDATE ledger SET id = 1, id = 2');
  }, /Duplicate UPDATE assignment column/);
  assert.throws(function () {
    model.parseSql('postgresql', 'UPDATE ledger SET id = row_number() OVER ()');
  }, /does not permit window expressions/);
  assert.throws(function () {
    model.parseSql('postgresql', 'INSERT INTO ledger DEFAULT VALUES');
  }, /supports VALUES or a SELECT query source/);
})();

(function ontologyCoverage() {
  ['statements.insert', 'statements.update', 'statements.delete', 'syntax.returning'].forEach(function (path) {
    var coverage = ontology.implementation(path);
    assert.strictEqual(coverage.scope, 'dml-v1', path + ' scope');
    assert.strictEqual(coverage.stages.parser, 'implemented', path + ' parser');
    assert.strictEqual(coverage.stages.ast, 'implemented', path + ' ast');
    assert.strictEqual(coverage.stages.renderer, 'implemented', path + ' renderer');
    assert.strictEqual(coverage.qualified, true, path + ' qualification');
    assert.ok(coverage.evidence.indexOf('test/sql-ast-wave4.js') >= 0, path + ' evidence');
  });
  assert.strictEqual(ontology.resolve('mysql', 'syntax.returning').available, false);
})();

console.log('NuBloxSQL Compiler Wave 4 INSERT/UPDATE/DELETE/RETURNING contract: PASS');
