'use strict';

var assert = require('assert');
var sql = require('..');
var model = sql.capabilityModel;
var ontology = sql.capabilityOntology;

(function addColumnPortableCore() {
  var source = 'ALTER TABLE ledger ADD COLUMN note VARCHAR(120)';
  var ast = model.parseSql('postgresql', source);
  assert.strictEqual(ast.type, 'AlterTableStatement');
  assert.strictEqual(ast.action.type, 'AddColumnAction');
  assert.strictEqual(ast.action.column.name.parts[0], 'note');
  assert.strictEqual(ast.action.column.dataType.name, 'VARCHAR');
  assert.deepStrictEqual(ast.action.column.dataType.modifiers, [120]);

  var analysis = model.analyzeAst(ast);
  assert.strictEqual(analysis.scope, 'ddl-v2');
  assert.deepStrictEqual(analysis.capabilities, ['schema.tableAlter.addColumn']);

  var mysql = model.transpileSql('postgresql', 'mysql', source);
  assert.strictEqual(mysql.scope, 'ddl-v2');
  assert.strictEqual(mysql.certified, true);
  assert.strictEqual(mysql.sql, 'ALTER TABLE `ledger` ADD COLUMN `note` VARCHAR(120)');

  var sqlite = model.transpileSql('postgresql', 'sqlite', source);
  assert.strictEqual(sqlite.certified, true);
  assert.strictEqual(sqlite.sql, 'ALTER TABLE "ledger" ADD COLUMN "note" VARCHAR(120)');
})();

(function addColumnConstraintsFailClosed() {
  assert.throws(function () {
    model.parseSql('postgresql', 'ALTER TABLE ledger ADD COLUMN note VARCHAR(120) NOT NULL');
  }, /plain column type without constraints or defaults/);
  assert.throws(function () {
    model.parseSql('postgresql', 'ALTER TABLE ledger ADD COLUMN amount INTEGER DEFAULT 0');
  }, /plain column type without constraints or defaults/);
  assert.throws(function () {
    model.parseSql('postgresql', 'ALTER TABLE ledger ADD COLUMN parent_id INTEGER REFERENCES parent (id)');
  }, /plain column type without constraints or defaults/);
})();

(function serverLifecycleOperationsArePortable() {
  var drop = model.transpileSql('postgresql', 'mysql', 'ALTER TABLE ledger DROP COLUMN obsolete');
  assert.strictEqual(drop.certified, true);
  assert.strictEqual(drop.sql, 'ALTER TABLE `ledger` DROP COLUMN `obsolete`');

  var renameColumn = model.transpileSql('postgresql', 'mysql', 'ALTER TABLE ledger RENAME COLUMN old_name TO new_name');
  assert.strictEqual(renameColumn.certified, true);
  assert.strictEqual(renameColumn.sql, 'ALTER TABLE `ledger` RENAME COLUMN `old_name` TO `new_name`');

  var renameTable = model.transpileSql('postgresql', 'mysql', 'ALTER TABLE ledger RENAME TO ledger_archive');
  assert.strictEqual(renameTable.certified, true);
  assert.strictEqual(renameTable.sql, 'ALTER TABLE `ledger` RENAME TO `ledger_archive`');
})();

(function sqliteVersionGating() {
  assert.throws(function () {
    model.transpileSql('postgresql', 'sqlite', 'ALTER TABLE ledger RENAME COLUMN old_name TO new_name');
  }, /requires runtime qualification/);
  assert.throws(function () {
    model.transpileSql('postgresql', 'sqlite', 'ALTER TABLE ledger DROP COLUMN obsolete');
  }, /requires runtime qualification/);

  var modern = model.qualify('sqlite', { version: '3.49.1', source: 'wave5b-static-test' });
  var renamed = model.transpileSql('postgresql', 'sqlite', 'ALTER TABLE ledger RENAME COLUMN old_name TO new_name', {
    targetQualification: modern
  });
  assert.strictEqual(renamed.certified, true);
  assert.strictEqual(renamed.sql, 'ALTER TABLE "ledger" RENAME COLUMN "old_name" TO "new_name"');

  var dropped = model.transpileSql('postgresql', 'sqlite', 'ALTER TABLE ledger DROP COLUMN obsolete', {
    targetQualification: modern
  });
  assert.strictEqual(dropped.certified, true);

  var old = model.qualify('sqlite', { version: '3.24.0', source: 'wave5b-static-test' });
  assert.throws(function () {
    model.transpileSql('postgresql', 'sqlite', 'ALTER TABLE ledger RENAME COLUMN old_name TO new_name', {
      targetQualification: old
    });
  }, /blocked by unsupported target capabilities/);
  assert.throws(function () {
    model.transpileSql('postgresql', 'sqlite', 'ALTER TABLE ledger DROP COLUMN obsolete', {
      targetQualification: old
    });
  }, /blocked by unsupported target capabilities/);

  var middle = model.qualify('sqlite', { version: '3.30.0', source: 'wave5b-static-test' });
  assert.strictEqual(model.transpileSql('postgresql', 'sqlite', 'ALTER TABLE ledger RENAME COLUMN old_name TO new_name', {
    targetQualification: middle
  }).certified, true);
  assert.throws(function () {
    model.transpileSql('postgresql', 'sqlite', 'ALTER TABLE ledger DROP COLUMN obsolete', {
      targetQualification: middle
    });
  }, /blocked by unsupported target capabilities/);
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
    model.parseSql('postgresql', 'ALTER TABLE ledger ALTER COLUMN amount TYPE BIGINT');
  }, /supports ADD COLUMN, DROP COLUMN, RENAME COLUMN and RENAME TO/);
  assert.throws(function () {
    model.parseSql('postgresql', 'ALTER TABLE ledger RENAME COLUMN name TO name');
  }, /source and target must differ/);
  assert.throws(function () {
    model.parseSql('postgresql', 'ALTER TABLE ledger RENAME TO ledger');
  }, /source and target must differ/);
  assert.throws(function () {
    model.parseSql('postgresql', 'ALTER TABLE ledger ADD COLUMN note TEXT, ADD COLUMN other TEXT');
  }, /ALTER TABLE definition|Unsupported|Unexpected|requires exactly one column/);
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
    assert.strictEqual(coverage.scope, 'ddl-v2');
    assert.strictEqual(coverage.stages.parser, 'implemented');
    assert.strictEqual(coverage.stages.validator, 'implemented');
    assert.strictEqual(coverage.stages.renderer, 'implemented');
    assert.strictEqual(coverage.qualified, true);
  });

  assert.strictEqual(ontology.resolve('postgresql', 'schema.tableAlter.dropColumn').available, true);
  assert.strictEqual(ontology.resolve('mysql', 'schema.tableAlter.renameColumn').available, true);

  var sqliteOldRename = ontology.resolve('sqlite', 'schema.tableAlter.renameColumn', { version: '3.24.0' });
  var sqliteModernRename = ontology.resolve('sqlite', 'schema.tableAlter.renameColumn', { version: '3.49.1' });
  var sqliteOldDrop = ontology.resolve('sqlite', 'schema.tableAlter.dropColumn', { version: '3.30.0' });
  var sqliteModernDrop = ontology.resolve('sqlite', 'schema.tableAlter.dropColumn', { version: '3.49.1' });
  assert.strictEqual(sqliteOldRename.available, false);
  assert.strictEqual(sqliteModernRename.available, true);
  assert.strictEqual(sqliteOldDrop.available, false);
  assert.strictEqual(sqliteModernDrop.available, true);
})();

console.log('NuBloxSQL Compiler Wave 5b ALTER TABLE lifecycle contract: PASS');
