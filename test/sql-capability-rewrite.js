'use strict';

var assert = require('assert');
var sql = require('..');
var model = sql.capabilityModel;

var preserve = model.rewriteDecision('postgresql', 'mysql', 'queries.joins.inner');
assert.strictEqual(preserve.action, 'preserve');
assert.strictEqual(preserve.lossless, true);
assert.ok(Object.isFrozen(preserve));

var blocked = model.rewriteDecision('postgresql', 'sqlite', 'queries.joins.lateral');
assert.strictEqual(blocked.action, 'reject');
assert.strictEqual(blocked.level, 'unsupported');
assert.strictEqual(blocked.lossless, false);

var equivalent = model.rewriteDecision('postgresql', 'sqlite', 'schema.schema');
assert.strictEqual(equivalent.action, 'rewrite');
assert.strictEqual(equivalent.level, 'equivalent');
assert.strictEqual(equivalent.lossless, null);

var unresolved = model.rewriteDecision('postgresql', 'sqlite', 'queries.joins.right');
assert.strictEqual(unresolved.action, 'qualify');

var sqliteOld = model.qualify('sqlite', { version: '3.38.5' });
var oldRight = model.rewriteDecision('postgresql', 'sqlite', 'queries.joins.right', { targetQualification: sqliteOld });
assert.strictEqual(oldRight.action, 'reject');
assert.strictEqual(oldRight.targetResolution, 'runtime-version');

var sqliteNew = model.qualify('sqlite', { version: '3.40.0' });
var newRight = model.rewriteDecision('postgresql', 'sqlite', 'queries.joins.right', { targetQualification: sqliteNew });
assert.strictEqual(newRight.action, 'preserve');
assert.strictEqual(newRight.lossless, true);

var plan = model.planRewrite('postgresql', 'sqlite', [
  'queries.joins.inner',
  'queries.joins.lateral',
  'queries.joins.right',
  'queries.joins.inner'
], { targetQualification: sqliteNew });
assert.strictEqual(plan.decisions.length, 3);
assert.strictEqual(plan.summary.preserve, 2);
assert.strictEqual(plan.summary.reject, 1);
assert.strictEqual(plan.blocked, true);
assert.strictEqual(plan.safeToProceed, false);
assert.ok(Object.isFrozen(plan));
assert.ok(Object.isFrozen(plan.decisions));

var pgToMysql = model.rewriteSql(
  'postgresql',
  'mysql',
  "SELECT $2, '$1', $$ $3 $$, \"$4\" FROM t WHERE id = $1 -- $9\nAND x = $2"
);
assert.strictEqual(pgToMysql.sql, "SELECT ?, '$1', $$ $3 $$, \"$4\" FROM t WHERE id = ? -- $9\nAND x = ?");
assert.deepStrictEqual(Array.from(pgToMysql.parameters.targetToSource), [2, 1, 2]);
assert.strictEqual(pgToMysql.changed, true);
assert.strictEqual(pgToMysql.lossless, true);
assert.strictEqual(pgToMysql.rules[0].id, 'parameter-markers');

var pgToSqlite = model.rewriteSql('postgresql', 'sqlite', 'SELECT $2 + $1');
assert.strictEqual(pgToSqlite.sql, 'SELECT ?2 + ?1');
assert.deepStrictEqual(Array.from(pgToSqlite.parameters.targetToSource), [2, 1]);

var mysqlToPg = model.rewriteSql('mysql', 'postgresql', "SELECT ?, '?' /* ? */ FROM t WHERE a = ? # ?\nAND b = ?");
assert.strictEqual(mysqlToPg.sql, "SELECT $1, '?' /* ? */ FROM t WHERE a = $2 # ?\nAND b = $3");
assert.deepStrictEqual(Array.from(mysqlToPg.parameters.targetToSource), [1, 2, 3]);

var sqliteToPg = model.rewriteSql('sqlite', 'postgresql', 'SELECT ?2, ?, :name, :name, @other');
assert.strictEqual(sqliteToPg.sql, 'SELECT $1, $2, $3, $4, $5');
assert.deepStrictEqual(Array.from(sqliteToPg.parameters.targetToSource), [2, 3, ':name', ':name', '@other']);

assert.throws(function () {
  model.rewriteSql('postgresql', 'sqlite', 'SELECT $1', { capabilities: ['queries.joins.lateral'] });
}, /blocked by unsupported target capabilities/);

assert.throws(function () {
  model.rewriteSql('postgresql', 'sqlite', 'SELECT $1', { capabilities: ['expressions.json'] });
}, /requires runtime qualification/);

var qualifiedJson = model.qualify('sqlite', { version: '3.49.0', features: { 'expressions.json': true } });
var qualifiedRewrite = model.rewriteSql('postgresql', 'sqlite', 'SELECT $1', {
  capabilities: ['expressions.json'],
  targetQualification: qualifiedJson
});
assert.strictEqual(qualifiedRewrite.plan.safeToProceed, true);

assert.throws(function () { model.planRewrite('postgresql', 'sqlite', []); }, /at least one capability path/);
assert.throws(function () { model.rewriteSql('sqlserver', 'sqlite', 'SELECT 1'); }, /Tier-1 dialects/);

console.log('NuBloxSQL Tier-1 rewrite planning and parameter-marker contracts: PASS');
