'use strict';

var assert = require('assert');
var sql = require('..');
var model = sql.capabilityModel;
var ontology = sql.capabilityOntology;

(function postgresOnConflictAstAndCompile() {
  var source = 'INSERT INTO ledger (id, name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET name = excluded.name WHERE ledger.id = $3 RETURNING id';
  var ast = model.parseSql('postgresql', source);
  assert.strictEqual(ast.type, 'UpsertStatement');
  assert.strictEqual(ast.syntax, 'on-conflict');
  assert.strictEqual(ast.insert.type, 'InsertStatement');
  assert.deepStrictEqual(ast.conflict.target[0].parts, ['id']);
  assert.strictEqual(ast.conflict.action, 'update');
  assert.strictEqual(ast.conflict.assignments.length, 1);
  assert.strictEqual(ast.returning.length, 1);

  var analysis = model.analyzeAst(ast);
  assert.strictEqual(analysis.scope, 'dml-v2');
  ['statements.insert', 'syntax.conflictHandling', 'syntax.returning'].forEach(function (path) {
    assert.ok(analysis.capabilities.indexOf(path) !== -1, 'missing ' + path);
  });

  var compiled = model.compileAst('postgresql', ast);
  assert.ok(compiled.sql.indexOf('INSERT INTO "ledger" ("id", "name") VALUES ($1, $2) ON CONFLICT ("id") DO UPDATE SET "name" = "excluded"."name"') === 0);
  assert.ok(compiled.sql.indexOf(' WHERE ("ledger"."id" = $3) RETURNING "id"') !== -1);
  assert.deepStrictEqual(compiled.targetToSource, [1, 2, 3]);
})();

(function onConflictPortableSubset() {
  var source = 'INSERT INTO ledger (id, name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET name = excluded.name';
  var sqlite = model.transpileSql('postgresql', 'sqlite', source);
  assert.strictEqual(sqlite.scope, 'dml-v2');
  assert.strictEqual(sqlite.certified, true);
  assert.strictEqual(sqlite.sql, 'INSERT INTO "ledger" ("id", "name") VALUES (?1, ?2) ON CONFLICT ("id") DO UPDATE SET "name" = "excluded"."name"');
  assert.deepStrictEqual(sqlite.targetToSource, [1, 2]);

  assert.throws(function () {
    model.transpileSql('postgresql', 'mysql', source);
  }, /not losslessly portable/);
})();

(function postgresDoNothing() {
  var result = model.transpileSql('postgresql', 'sqlite', 'INSERT INTO ledger (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING');
  assert.strictEqual(result.certified, true);
  assert.ok(result.sql.indexOf('ON CONFLICT ("id") DO NOTHING') !== -1);
})();

(function mysqlOnDuplicateKeyIsExplicitlySeparate() {
  var source = 'INSERT INTO ledger (id, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)';
  var ast = model.parseSql('mysql', source);
  assert.strictEqual(ast.type, 'UpsertStatement');
  assert.strictEqual(ast.syntax, 'on-duplicate-key');
  assert.strictEqual(ast.conflict.action, 'update');

  var same = model.transpileSql('mysql', 'mysql', source);
  assert.strictEqual(same.scope, 'dml-v2');
  assert.strictEqual(same.certified, true);
  assert.strictEqual(same.sql, 'INSERT INTO `ledger` (`id`, `name`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)');
  assert.deepStrictEqual(same.targetToSource, [1, 2]);

  assert.throws(function () {
    model.transpileSql('mysql', 'postgresql', source);
  }, /not losslessly portable/);
})();

(function mergePostgresSemanticNode() {
  var source = 'MERGE INTO ledger AS t USING incoming AS s ON t.id = s.id WHEN MATCHED THEN UPDATE SET name = s.name WHEN NOT MATCHED THEN INSERT (id, name) VALUES (s.id, s.name)';
  var ast = model.parseSql('postgresql', source);
  assert.strictEqual(ast.type, 'MergeStatement');
  assert.deepStrictEqual(ast.target.parts, ['ledger']);
  assert.deepStrictEqual(ast.source.parts, ['incoming']);
  assert.strictEqual(ast.matched.action, 'update');
  assert.strictEqual(ast.notMatched.values.length, 2);

  var analysis = model.analyzeAst(ast);
  assert.strictEqual(analysis.scope, 'dml-v2');
  assert.ok(analysis.capabilities.indexOf('statements.merge') !== -1);

  var compiled = model.compileAst('postgresql', ast);
  assert.strictEqual(compiled.sql, 'MERGE INTO "ledger" AS "t" USING "incoming" AS "s" ON ("t"."id" = "s"."id") WHEN MATCHED THEN UPDATE SET "name" = "s"."name" WHEN NOT MATCHED THEN INSERT ("id", "name") VALUES ("s"."id", "s"."name")');

  var same = model.transpileSql('postgresql', 'postgresql', source);
  assert.strictEqual(same.certified, true);
  assert.strictEqual(same.scope, 'dml-v2');

  assert.throws(function () {
    model.transpileSql('postgresql', 'mysql', source);
  }, /MERGE has no certified automatic rewrite/);
  assert.throws(function () {
    model.parseSql('mysql', source);
  }, /MERGE is not valid/);
})();

(function mergeDeleteAction() {
  var ast = model.parseSql('postgresql', 'MERGE INTO ledger USING incoming ON ledger.id = incoming.id WHEN MATCHED THEN DELETE');
  assert.strictEqual(ast.type, 'MergeStatement');
  assert.strictEqual(ast.matched.action, 'delete');
  assert.strictEqual(ast.notMatched, null);
  assert.ok(model.compileAst('postgresql', ast).sql.indexOf('WHEN MATCHED THEN DELETE') !== -1);
})();

(function invalidSemanticFormsFailClosed() {
  assert.throws(function () {
    model.parseSql('postgresql', 'INSERT INTO ledger (id, name) VALUES (1, 2) ON CONFLICT DO UPDATE SET name = excluded.name');
  }, /explicit conflict column target/);
  assert.throws(function () {
    model.parseSql('postgresql', 'MERGE INTO ledger USING incoming ON ledger.id = incoming.id');
  }, /requires at least one WHEN clause/);
})();

(function ontologyCoverage() {
  ['syntax.conflictHandling', 'statements.merge'].forEach(function (path) {
    var coverage = ontology.implementation(path);
    assert.strictEqual(coverage.scope, 'dml-v2', path + ' scope');
    assert.strictEqual(coverage.stages.parser, 'implemented', path + ' parser');
    assert.strictEqual(coverage.stages.ast, 'implemented', path + ' ast');
    assert.strictEqual(coverage.stages.renderer, 'implemented', path + ' renderer');
    assert.strictEqual(coverage.qualified, true, path + ' qualification');
  });
  assert.strictEqual(ontology.resolve('postgresql', 'statements.merge').available, true);
  assert.strictEqual(ontology.resolve('mysql', 'statements.merge').available, false);
  assert.strictEqual(ontology.resolve('sqlite', 'statements.merge').available, false);
})();

console.log('NuBloxSQL Compiler Wave 4b UPSERT/MERGE semantic contract: PASS');
