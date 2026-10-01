'use strict';

var assert = require('assert');
var sql = require('..');
var model = sql.capabilityModel;

(function parseAnalyzeCompile() {
  var source = 'SELECT DISTINCT u.id, u.name AS label, count(*) AS total FROM public.users AS u LEFT JOIN orders o ON o.user_id = u.id WHERE u.tenant_id = $2 AND u.id = $1 GROUP BY u.id, u.name HAVING count(*) > 0 ORDER BY u.name DESC LIMIT 25 OFFSET 5';
  var ast = model.parseSql('postgresql', source);
  assert.strictEqual(ast.type, 'SelectStatement');
  assert.strictEqual(ast.distinct, true);
  assert.strictEqual(ast.columns.length, 3);
  assert.strictEqual(ast.joins.length, 1);
  assert.strictEqual(ast.joins[0].kind, 'LEFT');
  assert.ok(Object.isFrozen(ast));

  var analysis = model.analyzeAst(ast);
  assert.ok(analysis.capabilities.indexOf('statements.select') !== -1);
  assert.ok(analysis.capabilities.indexOf('queries.distinct.standard') !== -1);
  assert.ok(analysis.capabilities.indexOf('queries.joins.left') !== -1);
  assert.ok(analysis.capabilities.indexOf('queries.grouping.groupBy') !== -1);
  assert.ok(analysis.capabilities.indexOf('queries.grouping.having') !== -1);
  assert.ok(analysis.capabilities.indexOf('queries.ordering.orderBy') !== -1);
  assert.ok(analysis.capabilities.indexOf('queries.pagination.limit') !== -1);
  assert.ok(analysis.capabilities.indexOf('queries.pagination.offset') !== -1);

  var mysql = model.compileAst('mysql', ast);
  assert.ok(mysql.sql.indexOf('SELECT DISTINCT `u`.`id`') === 0);
  assert.ok(mysql.sql.indexOf('LEFT JOIN `orders` AS `o`') !== -1);
  assert.ok(mysql.sql.indexOf('count(*) AS `total`') !== -1);
  assert.deepStrictEqual(mysql.targetToSource, [2, 1]);

  var transpiled = model.transpileSql('postgresql', 'mysql', source);
  assert.strictEqual(transpiled.certified, true);
  assert.strictEqual(transpiled.lossless, true);
  assert.deepStrictEqual(transpiled.targetToSource, [2, 1]);
  assert.ok(transpiled.sql.indexOf('LIMIT 25 OFFSET 5') !== -1);
})();

(function mysqlParametersToPostgres() {
  var result = model.transpileSql('mysql', 'postgresql', 'SELECT id FROM users WHERE tenant_id = ? AND id = ?');
  assert.ok(result.sql.indexOf('$1') !== -1);
  assert.ok(result.sql.indexOf('$2') !== -1);
  assert.deepStrictEqual(result.targetToSource, [1, 2]);
})();

(function sqliteNamedParametersReuseBinding() {
  var result = model.transpileSql('sqlite', 'postgresql', 'SELECT * FROM users WHERE tenant_id = :tenant OR owner_id = :tenant');
  assert.strictEqual((result.sql.match(/\$1/g) || []).length, 2);
  assert.deepStrictEqual(result.targetToSource, [':tenant']);
})();

(function unsupportedJoinIsBlocked() {
  assert.throws(function () {
    model.transpileSql('postgresql', 'mysql', 'SELECT * FROM a FULL JOIN b ON b.id = a.id');
  }, /blocked by unsupported target capabilities/);
})();

(function runtimeJoinQualification() {
  assert.throws(function () {
    model.transpileSql('postgresql', 'sqlite', 'SELECT * FROM a RIGHT JOIN b ON b.id = a.id');
  }, /requires runtime qualification/);
  var qualified = model.qualify('sqlite', { version: '3.49.1' });
  var result = model.transpileSql('postgresql', 'sqlite', 'SELECT * FROM a RIGHT JOIN b ON b.id = a.id', { targetQualification: qualified });
  assert.strictEqual(result.certified, true);
  assert.ok(result.sql.indexOf('RIGHT JOIN') !== -1);
})();

(function quotedIdentifiersAndLiterals() {
  var ast = model.parseSql('mysql', 'SELECT `user`.id, \'? not a parameter\' AS label FROM `user` WHERE id = ?');
  var pg = model.compileAst('postgresql', ast);
  assert.ok(pg.sql.indexOf('"user"."id"') !== -1);
  assert.ok(pg.sql.indexOf("'? not a parameter'") !== -1);
  assert.deepStrictEqual(pg.targetToSource, [1]);
})();

(function unsupportedGrammarFailsClosed() {
  assert.throws(function () { model.parseSql('postgresql', 'WITH x AS (SELECT 1) SELECT * FROM x'); }, /Only SELECT statements are supported/);
  assert.throws(function () { model.parseSql('postgresql', 'SELECT * FROM users UNION SELECT * FROM archive'); }, /Unexpected trailing SQL/);
})();

console.log('NuBloxSQL Tier-1 SQL AST/compiler contract: PASS');
