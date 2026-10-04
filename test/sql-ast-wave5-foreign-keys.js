'use strict';

var assert = require('assert');
var sql = require('..');
var model = sql.capabilityModel;
var ontology = sql.capabilityOntology;

function sqliteQualification(paths) {
  var features = { 'integrity.foreignKey': true };
  paths.forEach(function (path) { features[path] = true; });
  return model.qualify('sqlite', { version: '3.49.1', features: features, source: 'ddl-v7-static-test' });
}

(function createTableActionsAreStructured() {
  var source = 'CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent (id) ON DELETE CASCADE ON UPDATE RESTRICT)';
  var ast = model.parseSql('postgresql', source);
  assert.strictEqual(ast.columns[1].references.onDelete, 'cascade');
  assert.strictEqual(ast.columns[1].references.onUpdate, 'restrict');
  var analysis = model.analyzeAst(ast);
  assert.strictEqual(analysis.scope, 'ddl-v7');
  assert.ok(analysis.capabilities.indexOf('integrity.onDeleteCascade') !== -1);
  assert.ok(analysis.capabilities.indexOf('integrity.onUpdateRestrict') !== -1);
  var mysql = model.transpileSql('postgresql', 'mysql', source);
  assert.strictEqual(mysql.certified, true);
  assert.strictEqual(mysql.scope, 'ddl-v7');
  assert.ok(/ON DELETE CASCADE/.test(mysql.sql));
  assert.ok(/ON UPDATE RESTRICT/.test(mysql.sql));
})();

(function sqliteActionsRequireRuntimeEvidence() {
  var source = 'CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent (id) ON DELETE SET NULL ON UPDATE CASCADE)';
  assert.throws(function () { model.transpileSql('postgresql', 'sqlite', source); }, /runtime qualification/);
  var runtime = sqliteQualification(['integrity.onDeleteSetNull', 'integrity.onUpdateCascade']);
  var result = model.transpileSql('postgresql', 'sqlite', source, { targetQualification: runtime });
  assert.strictEqual(result.certified, true);
  assert.ok(/ON DELETE SET NULL/.test(result.sql));
  assert.ok(/ON UPDATE CASCADE/.test(result.sql));
})();

(function deferrableForeignKeysAreExplicit() {
  var source = 'CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent (id) DEFERRABLE INITIALLY DEFERRED)';
  var ast = model.parseSql('postgresql', source);
  assert.strictEqual(ast.columns[1].references.deferrable, true);
  assert.strictEqual(ast.columns[1].references.initially, 'deferred');
  assert.strictEqual(model.transpileSql('postgresql', 'postgresql', source).certified, true);
  var runtime = sqliteQualification(['integrity.deferrableForeignKeys', 'integrity.initiallyDeferred']);
  var sqlite = model.transpileSql('postgresql', 'sqlite', source, { targetQualification: runtime });
  assert.strictEqual(sqlite.certified, true);
  assert.ok(/DEFERRABLE INITIALLY DEFERRED/.test(sqlite.sql));
  assert.throws(function () { model.parseSql('postgresql', 'CREATE TABLE bad (parent_id INTEGER REFERENCES parent (id) INITIALLY DEFERRED)'); }, /requires DEFERRABLE/);
  assert.throws(function () { model.transpileSql('postgresql', 'mysql', source); }, /unsupported target capabilities|DEFERRABLE/);
})();

(function matchSemanticsFailClosed() {
  var fullSql = 'CREATE TABLE child (a INTEGER, b INTEGER, FOREIGN KEY (a, b) REFERENCES parent (a, b) MATCH FULL)';
  var full = model.parseSql('postgresql', fullSql);
  assert.strictEqual(full.constraints[0].references.match, 'full');
  assert.strictEqual(model.transpileSql('postgresql', 'postgresql', fullSql).certified, true);
  assert.throws(function () { model.parseSql('postgresql', 'CREATE TABLE child (a INTEGER REFERENCES parent (a) MATCH PARTIAL)'); }, /MATCH PARTIAL/);
  assert.throws(function () { model.parseSql('mysql', 'CREATE TABLE child (a INTEGER REFERENCES parent (a) MATCH SIMPLE)'); }, /MATCH semantics/);
  assert.throws(function () { model.parseSql('sqlite', 'CREATE TABLE child (a INTEGER REFERENCES parent (a) MATCH FULL)'); }, /MATCH semantics/);
  assert.throws(function () { model.transpileSql('postgresql', 'mysql', fullSql); }, /unsupported target capabilities|MATCH/);
})();

(function mysqlNoActionAndSetDefaultAreHonest() {
  assert.throws(function () { model.transpileSql('postgresql', 'mysql', 'CREATE TABLE child (a INTEGER REFERENCES parent (a) ON DELETE NO ACTION)'); }, /NO ACTION|semantic decision/);
  assert.throws(function () { model.parseSql('mysql', 'CREATE TABLE child (a INTEGER REFERENCES parent (a) ON DELETE SET DEFAULT)'); }, /SET DEFAULT/);
})();

(function namedAlterForeignKeyIsFirstClass() {
  var source = 'ALTER TABLE child ADD CONSTRAINT child_parent_fk FOREIGN KEY (parent_id) REFERENCES parent (id) ON DELETE CASCADE ON UPDATE RESTRICT';
  var ast = model.parseSql('postgresql', source);
  assert.strictEqual(ast.action.constraint.references.onDelete, 'cascade');
  var analysis = model.analyzeAst(ast);
  assert.strictEqual(analysis.scope, 'ddl-v7');
  assert.ok(analysis.capabilities.indexOf('schema.tableAlter.addForeignKey') !== -1);
  assert.strictEqual(analysis.capabilities.indexOf('schema.tableAlter.addConstraint'), -1);
  var mysql = model.transpileSql('postgresql', 'mysql', source);
  assert.strictEqual(mysql.certified, true);
  assert.ok(/^ALTER TABLE/.test(mysql.sql));
  assert.ok(/ADD CONSTRAINT/.test(mysql.sql));
  assert.ok(/ON DELETE CASCADE/.test(mysql.sql));
})();

(function ontologyCoverageIsExplicit() {
  [
    'schema.tableAlter.addForeignKey',
    'integrity.matchSimple', 'integrity.matchFull', 'integrity.matchPartial',
    'integrity.deferrableForeignKeys', 'integrity.notDeferrableForeignKeys',
    'integrity.initiallyDeferred', 'integrity.initiallyImmediate',
    'integrity.onDeleteCascade', 'integrity.onDeleteSetNull', 'integrity.onDeleteSetDefault',
    'integrity.onDeleteRestrict', 'integrity.onDeleteNoAction',
    'integrity.onUpdateCascade', 'integrity.onUpdateSetNull', 'integrity.onUpdateSetDefault',
    'integrity.onUpdateRestrict', 'integrity.onUpdateNoAction'
  ].forEach(function (path) {
    var coverage = ontology.implementation(path);
    assert.ok(coverage, path);
    assert.strictEqual(coverage.scope, 'ddl-v7');
    assert.strictEqual(coverage.qualified, true);
  });
})();

console.log('NuBloxSQL Wave 5g foreign-key semantic contract: PASS');
