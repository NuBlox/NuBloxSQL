'use strict';

var assert = require('assert');
var sql = require('..');
var model = sql.capabilityModel;
var ontology = sql.capabilityOntology;

(function portableSafeDrops() {
  var table = model.transpileSql('postgresql', 'mysql', 'DROP TABLE IF EXISTS ledger');
  assert.strictEqual(table.scope, 'ddl-v4');
  assert.strictEqual(table.certified, true);
  assert.strictEqual(table.sql, 'DROP TABLE IF EXISTS `ledger`');

  var view = model.transpileSql('mysql', 'sqlite', 'DROP VIEW IF EXISTS ledger_view');
  assert.strictEqual(view.certified, true);
  assert.strictEqual(view.sql, 'DROP VIEW IF EXISTS "ledger_view"');
})();

(function createExistenceModifiers() {
  var table = model.transpileSql('postgresql', 'sqlite', 'CREATE TABLE IF NOT EXISTS ledger (id INTEGER PRIMARY KEY)');
  assert.strictEqual(table.scope, 'ddl-v4');
  assert.strictEqual(table.certified, true);
  assert.ok(/^CREATE TABLE IF NOT EXISTS/.test(table.sql));

  var index = model.transpileSql('postgresql', 'sqlite', 'CREATE INDEX IF NOT EXISTS ledger_id_idx ON ledger (id)');
  assert.strictEqual(index.certified, true);
  assert.strictEqual(index.sql, 'CREATE INDEX IF NOT EXISTS "ledger_id_idx" ON "ledger" ("id")');

  assert.throws(function () {
    model.transpileSql('postgresql', 'mysql', 'CREATE INDEX IF NOT EXISTS ledger_id_idx ON ledger (id)');
  }, /unsupported target capabilities|does not support CREATE INDEX IF NOT EXISTS/);
  assert.throws(function () {
    model.parseSql('mysql', 'CREATE INDEX IF NOT EXISTS ledger_id_idx ON ledger (id)');
  }, /not valid MySQL source syntax/);
})();

(function dropIndexIdentityIsExplicit() {
  var pg = model.parseSql('postgresql', 'DROP INDEX IF EXISTS public.ledger_id_idx');
  assert.strictEqual(pg.type, 'DropIndexStatement');
  assert.strictEqual(pg.ifExists, true);
  assert.strictEqual(pg.table, null);
  assert.strictEqual(model.analyzeAst(pg).scope, 'ddl-v4');

  var portable = model.transpileSql('postgresql', 'sqlite', 'DROP INDEX IF EXISTS ledger_id_idx');
  assert.strictEqual(portable.certified, true);
  assert.strictEqual(portable.sql, 'DROP INDEX IF EXISTS "ledger_id_idx"');

  var mysql = model.transpileSql('mysql', 'mysql', 'DROP INDEX ledger_id_idx ON ledger');
  assert.strictEqual(mysql.certified, true);
  assert.strictEqual(mysql.sql, 'DROP INDEX `ledger_id_idx` ON `ledger`');

  assert.throws(function () {
    model.transpileSql('postgresql', 'mysql', 'DROP INDEX ledger_id_idx');
  }, /requires table identity|index-identity transformation/);
  assert.throws(function () {
    model.transpileSql('mysql', 'postgresql', 'DROP INDEX ledger_id_idx ON ledger');
  }, /index-identity transformation|losslessly identical/);
  assert.throws(function () {
    model.parseSql('mysql', 'DROP INDEX IF EXISTS ledger_id_idx ON ledger');
  }, /not valid MySQL source syntax/);
})();

(function schemaIdentityIsNotFlattened() {
  var pg = model.transpileSql('postgresql', 'postgresql', 'DROP SCHEMA IF EXISTS reporting');
  assert.strictEqual(pg.certified, true);
  assert.strictEqual(pg.sql, 'DROP SCHEMA IF EXISTS "reporting"');

  var mysql = model.transpileSql('mysql', 'mysql', 'DROP SCHEMA IF EXISTS reporting');
  assert.strictEqual(mysql.certified, true);
  assert.strictEqual(mysql.sql, 'DROP SCHEMA IF EXISTS `reporting`');

  assert.throws(function () {
    model.transpileSql('postgresql', 'mysql', 'DROP SCHEMA reporting');
  }, /not losslessly equivalent/);
  assert.throws(function () {
    model.transpileSql('mysql', 'postgresql', 'DROP SCHEMA reporting');
  }, /not losslessly equivalent/);
})();

(function sequenceLifecycleIsPostgresqlOnly() {
  var result = model.transpileSql('postgresql', 'postgresql', 'DROP SEQUENCE IF EXISTS ledger_seq');
  assert.strictEqual(result.certified, true);
  assert.strictEqual(result.sql, 'DROP SEQUENCE IF EXISTS "ledger_seq"');
  assert.throws(function () {
    model.transpileSql('postgresql', 'mysql', 'DROP SEQUENCE ledger_seq');
  }, /unsupported target capabilities|does not support DROP SEQUENCE/);
})();

(function createSequenceExistenceIsPostgresqlOnly() {
  var result = model.transpileSql('postgresql', 'postgresql', 'CREATE SEQUENCE IF NOT EXISTS ledger_seq');
  assert.strictEqual(result.certified, true);
  assert.strictEqual(result.sql, 'CREATE SEQUENCE IF NOT EXISTS "ledger_seq"');
  assert.throws(function () {
    model.transpileSql('postgresql', 'sqlite', 'CREATE SEQUENCE IF NOT EXISTS ledger_seq');
  }, /unsupported target capabilities|does not support CREATE SEQUENCE/);
})();

(function ontologyCoverage() {
  [
    'statements.dropIndex','statements.dropSchema','statements.dropSequence',
    'syntax.existence.createTableIfNotExists','syntax.existence.createIndexIfNotExists',
    'syntax.existence.createSchemaIfNotExists','syntax.existence.createSequenceIfNotExists',
    'syntax.existence.dropTableIfExists','syntax.existence.dropViewIfExists',
    'syntax.existence.dropIndexIfExists','syntax.existence.dropSchemaIfExists','syntax.existence.dropSequenceIfExists'
  ].forEach(function (path) {
    var coverage = ontology.implementation(path);
    assert.ok(coverage, path + ' coverage');
    assert.strictEqual(coverage.scope, 'ddl-v4', path + ' scope');
    assert.strictEqual(coverage.qualified, true, path + ' qualification');
  });
  assert.strictEqual(model.status('mysql', 'syntax.existence.createIndexIfNotExists').support, 'unsupported');
  assert.strictEqual(model.status('sqlite', 'statements.dropSequence').support, 'unsupported');
})();

console.log('NuBloxSQL Wave 5d object lifecycle and existence contract: PASS');
