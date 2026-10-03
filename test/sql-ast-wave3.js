'use strict';

var assert = require('assert');
var sql = require('..');
var model = sql.capabilityModel;

(function caseCastAndPredicates() {
  var source = "SELECT CASE WHEN amount BETWEEN $1 AND $2 THEN CAST(amount AS DECIMAL(10,2)) ELSE 0 END AS band FROM sales WHERE status NOT IN ('void', 'cancelled') AND name NOT LIKE 'x%'";
  var ast = model.parseSql('postgresql', source);
  assert.strictEqual(ast.type, 'SelectStatement');
  assert.strictEqual(ast.columns[0].type, 'AliasedExpression');
  assert.strictEqual(ast.columns[0].expression.type, 'CaseExpression');
  assert.strictEqual(ast.columns[0].expression.branches[0].when.type, 'BetweenExpression');
  assert.strictEqual(ast.columns[0].expression.branches[0].then.type, 'CastExpression');
  assert.strictEqual(ast.columns[0].expression.branches[0].then.targetType.name, 'DECIMAL');
  assert.deepStrictEqual(ast.columns[0].expression.branches[0].then.targetType.modifiers, [10, 2]);

  var analysis = model.analyzeAst(ast);
  assert.strictEqual(analysis.scope, 'select-query-v4');
  ['expressions.caseExpression', 'expressions.cast', 'expressions.comparison', 'expressions.like'].forEach(function (path) {
    assert.ok(analysis.capabilities.indexOf(path) !== -1, 'missing ' + path);
  });

  var mysql = model.transpileSql('postgresql', 'mysql', source);
  assert.strictEqual(mysql.scope, 'select-query-v4');
  assert.strictEqual(mysql.certified, true);
  assert.ok(mysql.sql.indexOf('CASE WHEN') !== -1);
  assert.ok(mysql.sql.indexOf('BETWEEN ? AND ?') !== -1);
  assert.ok(mysql.sql.indexOf('CAST(`amount` AS DECIMAL(10, 2))') !== -1);
  assert.ok(mysql.sql.indexOf("NOT IN ('void', 'cancelled')") !== -1);
  assert.ok(mysql.sql.indexOf("NOT LIKE 'x%'") !== -1);
  assert.deepStrictEqual(mysql.targetToSource, [1, 2]);
})();

(function simpleCaseAndPostgresCastAlias() {
  var simple = model.parseSql('postgresql', "SELECT CASE status WHEN 'open' THEN 1 WHEN 'closed' THEN 0 ELSE -1 END AS code FROM tickets");
  assert.strictEqual(simple.columns[0].expression.type, 'CaseExpression');
  assert.strictEqual(simple.columns[0].expression.operand.type, 'Identifier');
  assert.strictEqual(simple.columns[0].expression.branches.length, 2);

  var source = 'SELECT amount::DECIMAL(12,2) AS normalized FROM ledger';
  var ast = model.parseSql('postgresql', source);
  assert.strictEqual(ast.columns[0].expression.type, 'CastExpression');
  assert.strictEqual(ast.columns[0].expression.syntax, '::');
  var mysql = model.transpileSql('postgresql', 'mysql', source);
  assert.strictEqual(mysql.certified, true);
  assert.ok(mysql.sql.indexOf('CAST(`amount` AS DECIMAL(12, 2)) AS `normalized`') !== -1);
})();

(function inlineWindowSpecification() {
  var source = 'SELECT id, sum(amount) OVER (PARTITION BY tenant_id ORDER BY id ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS running FROM sales ORDER BY id';
  var ast = model.parseSql('postgresql', source);
  var window = ast.columns[1].expression;
  assert.strictEqual(window.type, 'WindowExpression');
  assert.strictEqual(window.over.type, 'WindowSpecification');
  assert.strictEqual(window.over.partitionBy.length, 1);
  assert.strictEqual(window.over.orderBy.length, 1);
  assert.strictEqual(window.over.frame.unit, 'ROWS');
  assert.strictEqual(window.over.frame.start.kind, 'VALUE PRECEDING');
  assert.strictEqual(window.over.frame.end.kind, 'CURRENT ROW');

  var analysis = model.analyzeAst(ast);
  assert.strictEqual(analysis.scope, 'select-query-v4');
  ['queries.windows.supported', 'queries.windows.rows'].forEach(function (path) {
    assert.ok(analysis.capabilities.indexOf(path) !== -1, 'missing ' + path);
  });

  var mysql = model.transpileSql('postgresql', 'mysql', source);
  assert.strictEqual(mysql.certified, true);
  assert.ok(mysql.sql.indexOf('sum(`amount`) OVER (PARTITION BY `tenant_id` ORDER BY `id` ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)') !== -1);
})();

(function namedWindows() {
  var source = 'SELECT id, sum(amount) OVER w AS running FROM sales WINDOW w AS (PARTITION BY tenant_id ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) ORDER BY id';
  var ast = model.parseSql('postgresql', source);
  assert.strictEqual(ast.windows.length, 1);
  assert.strictEqual(ast.windows[0].type, 'WindowDefinition');
  assert.strictEqual(ast.columns[1].expression.over.type, 'WindowReference');
  var analysis = model.analyzeAst(ast);
  assert.strictEqual(analysis.scope, 'select-query-v4');
  assert.ok(analysis.capabilities.indexOf('queries.windows.named') !== -1);

  var mysql = model.transpileSql('postgresql', 'mysql', source);
  assert.strictEqual(mysql.certified, true);
  assert.ok(mysql.sql.indexOf('OVER `w`') !== -1);
  assert.ok(mysql.sql.indexOf(' WINDOW `w` AS (PARTITION BY `tenant_id` ORDER BY `id` ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)') !== -1);
})();

(function windowTargetCapabilitiesFailClosed() {
  assert.throws(function () {
    model.transpileSql('postgresql', 'mysql', 'SELECT sum(amount) OVER (ORDER BY id GROUPS BETWEEN 1 PRECEDING AND CURRENT ROW) FROM sales');
  }, /blocked by unsupported target capabilities/);
})();

(function windowExcludeIsRepresented() {
  var ast = model.parseSql('postgresql', 'SELECT sum(amount) OVER (ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW EXCLUDE TIES) FROM sales');
  var window = ast.columns[0];
  assert.strictEqual(window.type, 'WindowExpression');
  assert.strictEqual(window.over.frame.exclude, 'TIES');
  var analysis = model.analyzeAst(ast);
  assert.ok(analysis.capabilities.indexOf('queries.windows.exclude') !== -1);
})();

(function invalidWindowReferencesFailClosed() {
  assert.throws(function () {
    model.parseSql('postgresql', 'SELECT row_number() OVER missing FROM users');
  }, /Unknown WINDOW reference/);
  assert.throws(function () {
    model.parseSql('postgresql', 'SELECT row_number() OVER w FROM users WINDOW w AS (), w AS ()');
  }, /Duplicate WINDOW name/);
  assert.throws(function () {
    model.parseSql('postgresql', 'SELECT sum(id) OVER (ORDER BY id ROWS UNBOUNDED FOLLOWING) FROM users');
  }, /cannot start with UNBOUNDED FOLLOWING/);
})();

console.log('NuBloxSQL Compiler Wave 3 CASE/CAST/window contract: PASS');
