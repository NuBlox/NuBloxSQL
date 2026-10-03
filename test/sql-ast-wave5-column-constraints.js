'use strict';

var assert = require('assert');
var sql = require('..');
var model = sql.capabilityModel;
var ontology = sql.capabilityOntology;

(function postgresColumnType() {
  var ast = model.parseSql('postgresql', 'ALTER TABLE ledger ALTER COLUMN amount TYPE DECIMAL(18, 4)');
  assert.strictEqual(ast.type, 'AlterTableStatement');
  assert.strictEqual(ast.action.type, 'AlterColumnTypeAction');
  assert.strictEqual(ast.action.dataType.name, 'DECIMAL');
  assert.deepStrictEqual(ast.action.dataType.modifiers, [18, 4]);
  var analysis = model.analyzeAst(ast);
  assert.strictEqual(analysis.scope, 'ddl-v3');
  assert.ok(analysis.capabilities.indexOf('schema.tableAlter.alterColumnType') >= 0);
  assert.strictEqual(model.compileAst('postgresql', ast).sql, 'ALTER TABLE "ledger" ALTER COLUMN "amount" TYPE DECIMAL(18, 4)');
})();

(function portableDefaultLifecycle() {
  var setDefault = model.transpileSql('postgresql', 'mysql', 'ALTER TABLE ledger ALTER COLUMN amount SET DEFAULT 0');
  assert.strictEqual(setDefault.scope, 'ddl-v3');
  assert.strictEqual(setDefault.certified, true);
  assert.strictEqual(setDefault.sql, 'ALTER TABLE `ledger` ALTER COLUMN `amount` SET DEFAULT 0');

  var dropDefault = model.transpileSql('mysql', 'postgresql', 'ALTER TABLE ledger ALTER COLUMN amount DROP DEFAULT');
  assert.strictEqual(dropDefault.certified, true);
  assert.strictEqual(dropDefault.sql, 'ALTER TABLE "ledger" ALTER COLUMN "amount" DROP DEFAULT');
})();

(function defaultExpressionCapabilitiesArePreserved() {
  var result = model.transpileSql('postgresql', 'mysql', 'ALTER TABLE ledger ALTER COLUMN amount SET DEFAULT CASE WHEN 1 = 1 THEN CAST(5 AS DECIMAL(10,2)) ELSE 0 END');
  assert.ok(result.capabilities.indexOf('schema.tableAlter.setDefault') >= 0);
  assert.ok(result.capabilities.indexOf('expressions.caseExpression') >= 0);
  assert.ok(result.capabilities.indexOf('expressions.cast') >= 0);
})();

(function nullabilityAndTypeFailClosedForMysql() {
  assert.throws(function () {
    model.transpileSql('postgresql', 'mysql', 'ALTER TABLE ledger ALTER COLUMN amount TYPE BIGINT');
  }, /semantic transformation/);
  assert.throws(function () {
    model.transpileSql('postgresql', 'mysql', 'ALTER TABLE ledger ALTER COLUMN amount SET NOT NULL');
  }, /semantic transformation/);
  assert.throws(function () {
    model.parseSql('mysql', 'ALTER TABLE ledger ALTER COLUMN amount SET NOT NULL');
  }, /only accepts MySQL ALTER COLUMN SET\/DROP DEFAULT/);
})();

(function sqliteFailsClosed() {
  assert.throws(function () {
    model.transpileSql('postgresql', 'sqlite', 'ALTER TABLE ledger ALTER COLUMN amount SET DEFAULT 0');
  }, /unsupported target capabilities/);
  assert.throws(function () {
    model.parseSql('sqlite', 'ALTER TABLE ledger ALTER COLUMN amount DROP DEFAULT');
  }, /not valid SQLite source syntax/);
})();

(function namedConstraintsAreExplicitPostgresqlSemantics() {
  var add = model.parseSql('postgresql', 'ALTER TABLE ledger ADD CONSTRAINT ledger_amount_positive CHECK (amount >= 0)');
  assert.strictEqual(add.action.type, 'AddConstraintAction');
  assert.strictEqual(add.action.constraint.type, 'CheckConstraint');
  assert.strictEqual(
    model.compileAst('postgresql', add).sql,
    'ALTER TABLE "ledger" ADD CONSTRAINT "ledger_amount_positive" CHECK (("amount" >= 0))'
  );

  var fk = model.parseSql('postgresql', 'ALTER TABLE ledger ADD CONSTRAINT ledger_parent_fk FOREIGN KEY (parent_id) REFERENCES ledger (id)');
  assert.strictEqual(fk.action.constraint.type, 'ForeignKeyConstraint');
  assert.strictEqual(model.compileAst('postgresql', fk).sql, 'ALTER TABLE "ledger" ADD CONSTRAINT "ledger_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "ledger" ("id")');

  var drop = model.transpileSql('postgresql', 'postgresql', 'ALTER TABLE ledger DROP CONSTRAINT ledger_amount_positive');
  assert.strictEqual(drop.certified, true);
  assert.strictEqual(drop.sql, 'ALTER TABLE "ledger" DROP CONSTRAINT "ledger_amount_positive"');

  assert.throws(function () {
    model.transpileSql('postgresql', 'mysql', 'ALTER TABLE ledger ADD CONSTRAINT ledger_amount_positive CHECK (amount >= 0)');
  }, /unsupported target capabilities|semantic transformation/);
})();

(function invalidDefinitionsFailClosed() {
  assert.throws(function () {
    model.parseSql('postgresql', 'ALTER TABLE ledger ALTER COLUMN amount SET DEFAULT $1');
  }, /cannot contain bind parameters/);
  assert.throws(function () {
    model.parseSql('postgresql', 'ALTER TABLE ledger ADD CONSTRAINT fk FOREIGN KEY (parent_id, tenant_id) REFERENCES ledger (id)');
  }, /width must match/);
})();

(function capabilityAndOntologyCoverage() {
  assert.strictEqual(model.status('postgresql', 'schema.tableAlter.alterColumnType').support, 'native');
  assert.strictEqual(model.status('mysql', 'schema.tableAlter.alterColumnType').support, 'equivalent');
  assert.strictEqual(model.status('mysql', 'schema.tableAlter.setDefault').support, 'native');
  assert.strictEqual(model.status('sqlite', 'schema.tableAlter.setDefault').support, 'unsupported');
  [
    'schema.tableAlter.alterColumnType',
    'schema.tableAlter.setDefault',
    'schema.tableAlter.dropDefault',
    'schema.tableAlter.setNotNull',
    'schema.tableAlter.dropNotNull',
    'schema.tableAlter.addConstraint',
    'schema.tableAlter.dropConstraint'
  ].forEach(function (path) {
    var coverage = ontology.implementation(path);
    assert.ok(coverage, path + ' implementation');
    assert.strictEqual(coverage.scope, 'ddl-v3', path + ' scope');
    assert.strictEqual(coverage.qualified, true, path + ' qualification');
  });
})();

console.log('NuBloxSQL Wave 5c ALTER COLUMN and constraint lifecycle contract: PASS');
