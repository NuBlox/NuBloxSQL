'use strict';

var assert = require('assert');
var sql = require('..');
var model = sql.capabilityModel;
var ontology = sql.capabilityOntology;

(function createTableAstAndCompiler() {
  var source = 'CREATE TABLE ledger (id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, name VARCHAR(100) NOT NULL UNIQUE, amount DECIMAL(12,2) DEFAULT 0 CHECK (amount >= 0), PRIMARY KEY (id))';
  assert.throws(function () { model.parseSql('postgresql', source); }, /more than one primary key/);

  source = 'CREATE TABLE ledger (id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, name VARCHAR(100) NOT NULL UNIQUE, amount DECIMAL(12,2) DEFAULT 0 CHECK (amount >= 0))';
  var ast = model.parseSql('postgresql', source);
  assert.strictEqual(ast.type, 'CreateTableStatement');
  assert.strictEqual(ast.columns.length, 4);
  assert.strictEqual(ast.columns[0].primaryKey, true);
  assert.strictEqual(ast.columns[1].nullable, false);
  assert.strictEqual(ast.columns[2].unique, true);
  assert.strictEqual(ast.columns[3].dataType.name, 'DECIMAL');
  assert.deepStrictEqual(ast.columns[3].dataType.modifiers, [12, 2]);
  assert.strictEqual(ast.columns[3].checks.length, 1);

  var analysis = model.analyzeAst(ast);
  assert.strictEqual(analysis.scope, 'ddl-v1');
  ['statements.createTable', 'integrity.primaryKey', 'integrity.notNull', 'integrity.unique', 'integrity.check'].forEach(function (path) {
    assert.ok(analysis.capabilities.indexOf(path) !== -1, 'missing DDL capability ' + path);
  });

  var mysql = model.transpileSql('postgresql', 'mysql', source);
  assert.strictEqual(mysql.scope, 'ddl-v1');
  assert.strictEqual(mysql.certified, true);
  assert.ok(mysql.sql.indexOf('CREATE TABLE `ledger`') === 0);
  assert.ok(mysql.sql.indexOf('`amount` DECIMAL(12, 2) DEFAULT 0 CHECK ((`amount` >= 0))') !== -1);
  assert.deepStrictEqual(mysql.targetToSource, []);

  var sqlite = model.transpileSql('postgresql', 'sqlite', source);
  assert.strictEqual(sqlite.certified, true);
  assert.ok(sqlite.sql.indexOf('CREATE TABLE "ledger"') === 0);
})();

(function tableConstraintsAndForeignKeys() {
  var source = 'CREATE TABLE child (tenant_id INTEGER NOT NULL, id INTEGER NOT NULL, parent_id INTEGER, PRIMARY KEY (tenant_id, id), UNIQUE (tenant_id, parent_id), FOREIGN KEY (parent_id) REFERENCES parent (id), CHECK (id > 0))';
  var ast = model.parseSql('postgresql', source);
  assert.strictEqual(ast.constraints.length, 4);
  var analysis = model.analyzeAst(ast);
  ['integrity.primaryKey', 'integrity.unique', 'integrity.foreignKey', 'integrity.check'].forEach(function (path) {
    assert.ok(analysis.capabilities.indexOf(path) !== -1, 'missing table constraint capability ' + path);
  });

  assert.throws(function () { model.transpileSql('postgresql', 'sqlite', source); }, /requires runtime qualification/);
  var qualification = model.qualify('sqlite', {
    version: '3.49.1',
    features: { 'integrity.foreignKey': true },
    source: 'wave5-static-test'
  });
  var sqlite = model.transpileSql('postgresql', 'sqlite', source, { targetQualification: qualification });
  assert.strictEqual(sqlite.certified, true);
  assert.ok(sqlite.sql.indexOf('FOREIGN KEY ("parent_id") REFERENCES "parent" ("id")') !== -1);

  var promoted = model.parseSql('postgresql', 'CREATE TABLE child_actions (id INTEGER, parent_id INTEGER REFERENCES parent (id) ON DELETE CASCADE)');
  assert.strictEqual(model.analyzeAst(promoted).scope, 'ddl-v7');
  assert.strictEqual(promoted.columns[1].references.onDelete, 'cascade');
})();

(function indexesAndPartialIndexGating() {
  var basic = model.transpileSql('postgresql', 'mysql', 'CREATE UNIQUE INDEX ledger_name_uq ON ledger (name)');
  assert.strictEqual(basic.certified, true);
  assert.strictEqual(basic.sql, 'CREATE UNIQUE INDEX `ledger_name_uq` ON `ledger` (`name`)');

  assert.throws(function () {
    model.transpileSql('postgresql', 'sqlite', 'CREATE INDEX ledger_active_idx ON ledger (id) WHERE amount > 0');
  }, /requires runtime qualification/);
  var partialQualification = model.qualify('sqlite', {
    version: '3.49.1',
    features: { 'schema.partialIndex': true },
    source: 'wave5-static-test'
  });
  var partialPg = model.transpileSql('postgresql', 'sqlite', 'CREATE INDEX ledger_active_idx ON ledger (id) WHERE amount > 0', {
    targetQualification: partialQualification
  });
  assert.strictEqual(partialPg.certified, true);
  assert.ok(partialPg.sql.indexOf('WHERE ("amount" > 0)') !== -1);

  assert.throws(function () {
    model.transpileSql('postgresql', 'mysql', 'CREATE INDEX ledger_active_idx ON ledger (id) WHERE amount > 0');
  }, /blocked by unsupported target capabilities/);
})();

(function viewsReuseQueryCompiler() {
  var result = model.transpileSql('postgresql', 'mysql', 'CREATE VIEW positive_ledger AS SELECT id, amount FROM ledger WHERE amount > 0');
  assert.strictEqual(result.scope, 'ddl-v1');
  assert.strictEqual(result.certified, true);
  assert.strictEqual(result.sql, 'CREATE VIEW `positive_ledger` AS SELECT `id`, `amount` FROM `ledger` WHERE (`amount` > 0)');
  assert.ok(result.capabilities.indexOf('statements.createView') !== -1);
  assert.ok(result.capabilities.indexOf('statements.select') !== -1);
})();

(function schemaAndSequenceFailClosed() {
  var schemaAst = model.parseSql('postgresql', 'CREATE SCHEMA accounting');
  assert.strictEqual(schemaAst.type, 'CreateSchemaStatement');
  assert.strictEqual(model.compileAst('postgresql', schemaAst).sql, 'CREATE SCHEMA "accounting"');
  assert.throws(function () { model.transpileSql('postgresql', 'mysql', 'CREATE SCHEMA accounting'); }, /explicit semantic rewrite|unsupported target capabilities/);
  assert.throws(function () { model.transpileSql('postgresql', 'sqlite', 'CREATE SCHEMA accounting'); }, /unsupported target capabilities/);

  var sequence = model.transpileSql('postgresql', 'postgresql', 'CREATE SEQUENCE ledger_seq');
  assert.strictEqual(sequence.certified, true);
  assert.strictEqual(sequence.sql, 'CREATE SEQUENCE "ledger_seq"');
  assert.throws(function () { model.transpileSql('postgresql', 'mysql', 'CREATE SEQUENCE ledger_seq'); }, /unsupported target capabilities/);
})();

(function dropsAndValidation() {
  assert.strictEqual(model.transpileSql('postgresql', 'mysql', 'DROP TABLE ledger').sql, 'DROP TABLE `ledger`');
  assert.strictEqual(model.transpileSql('postgresql', 'mysql', 'DROP VIEW positive_ledger').sql, 'DROP VIEW `positive_ledger`');
  assert.strictEqual(model.transpileSql('postgresql', 'sqlite', 'DROP VIEW positive_ledger').sql, 'DROP VIEW "positive_ledger"');

  assert.throws(function () { model.parseSql('postgresql', 'CREATE TABLE broken (id INTEGER, id TEXT)'); }, /Duplicate CREATE TABLE column/);
  assert.throws(function () { model.parseSql('postgresql', 'CREATE TABLE broken (id INTEGER, PRIMARY KEY (missing))'); }, /unknown local column/);
  assert.throws(function () { model.parseSql('postgresql', 'CREATE TABLE broken (id INTEGER DEFAULT $1)'); }, /bind parameters/);
  assert.throws(function () { model.parseSql('postgresql', 'CREATE VIEW bad AS SELECT $1 AS id'); }, /bind parameters/);
  assert.throws(function () { model.parseSql('postgresql', 'CREATE TABLE named (id INTEGER CONSTRAINT x PRIMARY KEY)'); }, /Named column constraints/);
})();

(function ontologyCoverage() {
  [
    'statements.createTable', 'statements.createIndex', 'statements.createView',
    'statements.createSchema', 'statements.createSequence', 'statements.dropTable', 'statements.dropView',
    'integrity.notNull', 'integrity.check', 'integrity.unique', 'integrity.primaryKey', 'integrity.foreignKey',
    'schema.uniqueIndex', 'schema.partialIndex'
  ].forEach(function (path) {
    var coverage = ontology.implementation(path);
    assert.ok(coverage, 'missing ontology implementation ' + path);
    assert.strictEqual(coverage.scope, 'ddl-v1', path + ' scope');
    assert.strictEqual(coverage.stages.parser, 'implemented', path + ' parser');
    assert.strictEqual(coverage.stages.renderer, 'implemented', path + ' renderer');
    assert.strictEqual(coverage.qualified, true, path + ' qualification');
  });
  assert.strictEqual(ontology.resolve('postgresql', 'statements.dropView').available, true);
  assert.strictEqual(ontology.resolve('mysql', 'statements.dropView').available, true);
})();

console.log('NuBloxSQL Compiler Wave 5 DDL contract: PASS');
