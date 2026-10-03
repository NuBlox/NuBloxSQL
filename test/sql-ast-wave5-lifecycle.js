'use strict';

var assert = require('assert');
var sql = require('..');
var model = sql.capabilityModel;
var ontology = sql.capabilityOntology;

(function addColumnPortableSubset() {
  var ast = model.parseSql('postgresql', 'ALTER TABLE ledger ADD COLUMN note VARCHAR(120)');
  assert.strictEqual(ast.type, 'AlterTableStatement');
  assert.strictEqual(ast.action.type, 'AddColumnAction');
  assert.deepStrictEqual(ast.table.parts, ['ledger']);
  assert.deepStrictEqual(ast.action.column.name.parts, ['note']);
  assert.strictEqual(ast.action.column.dataType.name, 'VARCHAR');
  assert.deepStrictEqual(ast.action.column.dataType.modifiers, [120]);

  var analysis = model.analyzeAst(ast);
  assert.strictEqual(analysis.scope, 'ddl-v2');
  assert.deepStrictEqual(analysis.capabilities, ['schema.tableAlter.addColumn']);

  var mysql = model.transpileSql('postgresql', 'mysql', 'ALTER TABLE ledger ADD COLUMN note VARCHAR(120)');
  assert.strictEqual(mysql.scope, 'ddl-v2');
  assert.strictEqual(mysql.certified, true);
  assert.strictEqual(mysql.sql, 'ALTER TABLE `ledger` ADD COLUMN `note` VARCHAR(120)');

  var sqlite = model.transpileSql('postgresql', 'sqlite', 'ALTER TABLE ledger ADD COLUMN note VARCHAR(120)');
  assert.strictEqual(sqlite.certified, true);
  assert.strictEqual(sqlite.sql, 'ALTER TABLE "ledger" ADD COLUMN "note" VARCHAR(120)');
})();

(function lifecycleActions() {
  var drop = model.transpileSql('postgresql', 'mysql', 'ALTER TABLE ledger DROP COLUMN obsolete');
  assert.strictEqual(drop.certified, true);
  assert.strictEqual(drop.sql, 'ALTER TABLE `ledger` DROP COLUMN `obsolete`');

  var renameColumn = model.transpileSql('postgresql', 'mysql', 'ALTER TABLE ledger RENAME COLUMN old_name TO new_name');
  assert.strictEqual(renameColumn.certified, true);
  assert.strictEqual(renameColumn.sql, 'ALTER TABLE `ledger` RENAME COLUMN `old_name` TO `new_name`');

  var renameTable = model.transpileSql('postgresql', 'sqlite', 'ALTER TABLE public.ledger RENAME TO ledger_archive');
  assert.strictEqual(renameTable.certified, true);
  assert.strictEqual(renameTable.sql, 'ALTER TABLE "public"."ledger" RENAME TO "ledger_archive"');
})();

(function constrainedAddFailsClosed() {
  assert.throws(function () {
    model.parseSql('postgresql', 'ALTER TABLE ledger ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
  }, /plain column type without constraints or defaults/);
  assert.throws(function () {
    model.parseSql('postgresql', 'ALTER TABLE ledger ADD COLUMN parent_id INTEGER REFERENCES ledger\(id\)');
  }, /plain column type without constraints or defaults|Unsupported SQL token/);
})();

(function sqliteVersionQualification() {
  assert.strictEqual(model.status('sqlite', 'schema.tableAlter.renameColumn').support, 'runtime-dependent');
  assert.strictEqual(model.status('sqlite', 'schema.tableAlter.dropColumn').support, 'runtime-dependent');

  var beforeRename = model.qualify('sqlite', { version: '3.24.0', source: 'wave5b-static-test' });
  assert.throws(function () {
    model.transpileSql('postgresql', 'sqlite', 'ALTER TABLE ledger RENAME COLUMN old_name TO new_name', {
      targetQualification: beforeRename
    });
  }, /blocked by unsupported target capabilities/);

  var beforeDrop = model.qualify('sqlite', { version: '3.34.1', source: 'wave5b-static-test' });
  assert.throws(function () {
    model.transpileSql('postgresql', 'sqlite', 'ALTER TABLE ledger DROP COLUMN obsolete', {
      targetQualification: beforeDrop
    });
  }, /blocked by unsupported target capabilities/);

  var supported = model.qualify('sqlite', { version: '3.49.1', source: 'wave5b-static-test' });
  var rename = model.transpileSql('postgresql', 'sqlite', 'ALTER TABLE ledger RENAME COLUMN old_name TO new_name', {
    targetQualification: supported
  });
  assert.strictEqual(rename.certified, true);
  assert.strictEqual(rename.sql, 'ALTER TABLE "ledger" RENAME COLUMN "old_name" TO "new_name"');
})();

(function sqliteSourceRequiresVersionEvidenceForVersionedSyntax() {
  assert.throws(function () {
    model.transpileSql('sqlite', 'postgresql', 'ALTER TABLE ledger RENAME COLUMN old_name TO new_name');
  }, /requires runtime qualification/);

  var sqliteSource = model.qualify('sqlite', { version: '3.49.1', source: 'wave5b-static-test' });
  var result = model.transpileSql('sqlite', 'postgresql', 'ALTER TABLE ledger RENAME COLUMN old_name TO new_name', {
    sourceQualification: sqliteSource
  });
  assert.strictEqual(result.certified, true);
  assert.strictEqual(result.sql, 'ALTER TABLE "ledger" RENAME COLUMN "old_name" TO "new_name"');
})();

(function invalidLifecycleSyntaxFailsClosed() {
  assert.throws(function () {
    model.parseSql('postgresql', 'ALTER TABLE ledger RENAME COLUMN name TO name');
  }, /source and target must differ/);
  assert.throws(function () {
    model.parseSql('postgresql', 'ALTER TABLE ledger RENAME TO ledger');
  }, /source and target must differ/);
  assert.throws(function () {
    model.parseSql('postgresql', 'ALTER TABLE ledger ADD COLUMN note TEXT, ADD COLUMN other TEXT');
  }, /ALTER TABLE definition|Unsupported|Unexpected|requires exactly one column/);
  assert.throws(function () {
    model.parseSql('postgresql', 'ALTER TABLE ledger ADD COLUMN note TEXT DEFAULT 1');
  }, /plain column type without constraints or defaults/);
})();

(function ontologyCoverageAndResolution() {
  [
    'schema.tableAlter.addColumn',
    'schema.tableAlter.dropColumn',
    'schema.tableAlter.renameColumn',
    'schema.tableAlter.renameTable'
  ].forEach(function (path) {
    var coverage = ontology.implementation(path);
    assert.ok(coverage, 'missing implementation coverage ' + path);
    assert.strictEqual(coverage.scope, 'ddl-v2', path + ' scope');
    assert.strictEqual(coverage.stages.parser, 'implemented', path + ' parser');
    assert.strictEqual(coverage.stages.validator, 'implemented', path + ' validator');
    assert.strictEqual(coverage.stages.renderer, 'implemented', path + ' renderer');
    assert.strictEqual(coverage.qualified, true, path + ' qualification');
  });

  var oldRename = ontology.resolve('sqlite', 'schema.tableAlter.renameColumn', { version: '3.24.0' });
  assert.strictEqual(oldRename.available, false);
  var newRename = ontology.resolve('sqlite', 'schema.tableAlter.renameColumn', { version: '3.25.0' });
  assert.strictEqual(newRename.available, true);
  var oldDrop = ontology.resolve('sqlite', 'schema.tableAlter.dropColumn', { version: '3.34.1' });
  assert.strictEqual(oldDrop.available, false);
  var newDrop = ontology.resolve('sqlite', 'schema.tableAlter.dropColumn', { version: '3.35.0' });
  assert.strictEqual(newDrop.available, true);
})();

console.log('NuBloxSQL Wave 5b ALTER TABLE lifecycle contract: PASS');
