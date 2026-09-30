'use strict';

var assert = require('assert');
var sql = require('..');
var model = sql.capabilityModel;

var lateralPgToMysql = model.compatibility('postgresql', 'mysql', 'queries.joins.lateral');
assert.strictEqual(lateralPgToMysql.compatible, true);
assert.strictEqual(lateralPgToMysql.level, 'exact');
assert.strictEqual(lateralPgToMysql.lossless, true);
assert.ok(Object.isFrozen(lateralPgToMysql));

var lateralPgToSqlite = model.compatibility('postgresql', 'sqlite', 'queries.joins.lateral');
assert.strictEqual(lateralPgToSqlite.compatible, false);
assert.strictEqual(lateralPgToSqlite.level, 'unsupported');
assert.ok(lateralPgToSqlite.reasons.some(function (entry) { return entry.code === 'target-unsupported'; }));

var sqliteJsonToPg = model.compatibility('sqlite', 'postgresql', 'expressions.json');
assert.strictEqual(sqliteJsonToPg.compatible, null);
assert.strictEqual(sqliteJsonToPg.level, 'runtime-dependent');

var queryPaths = model.paths('queries');
assert.ok(queryPaths.length > 10);
assert.ok(queryPaths.indexOf('queries.joins.lateral') >= 0);
assert.ok(Object.isFrozen(queryPaths));

var schemaComparison = model.compareCategory('schema');
assert.ok(schemaComparison.rows.length > 10);
var materialized = schemaComparison.rows.find(function (row) { return row.path === 'schema.materializedView'; });
assert.ok(materialized);
assert.strictEqual(materialized.universallySupported, false);

var matrix = model.matrix({ categories: ['queries', 'schema'] });
assert.deepStrictEqual(Array.from(matrix.dialects), ['postgresql', 'mysql', 'sqlite']);
assert.deepStrictEqual(Array.from(matrix.categories), ['queries', 'schema']);
assert.ok(matrix.rows.length > 20);
assert.strictEqual(matrix.summary.total, matrix.rows.length);
assert.ok(matrix.summary.universallySupported > 0);
assert.ok(matrix.summary.runtimeDependent > 0);
assert.ok(Object.isFrozen(matrix));
assert.ok(Object.isFrozen(matrix.summary));

var pgToMysqlQueries = model.migrationSurface('postgresql', 'mysql', 'queries');
assert.ok(pgToMysqlQueries.capabilities.length > 10);
assert.ok(pgToMysqlQueries.summary.exact > 0);

var pgToSqliteAll = model.migrationSurface('postgresql', 'sqlite');
assert.ok(pgToSqliteAll.summary.unsupported > 0);
assert.ok(pgToSqliteAll.summary.runtimeDependent > 0);

var pgToMysql = model.compareDialects('postgresql', 'mysql', { categories: ['queries', 'schema'] });
assert.strictEqual(pgToMysql.from, 'postgresql');
assert.strictEqual(pgToMysql.to, 'mysql');
assert.deepStrictEqual(Array.from(pgToMysql.categories), ['queries', 'schema']);
assert.ok(pgToMysql.capabilities.length > 20);
assert.strictEqual(
  pgToMysql.summary.exact + pgToMysql.summary.equivalent + pgToMysql.summary.emulated + pgToMysql.summary.partial +
  pgToMysql.summary.runtimeDependent + pgToMysql.summary.unsupported + pgToMysql.summary.notApplicable + pgToMysql.summary.unknown,
  pgToMysql.capabilities.length
);
assert.ok(Object.isFrozen(pgToMysql));

assert.throws(function () { model.compatibility('postgresql', 'sqlite', ''); }, /non-empty/);
assert.throws(function () { model.paths('not-a-category'); }, /Unknown SQL capability category/);
assert.throws(function () { model.compareCategory('queries', []); }, /at least one dialect/);
assert.throws(function () { model.matrix({ categories: [] }); }, /non-empty array/);
assert.throws(function () { model.compareDialects('sqlserver', 'postgresql'); }, /Tier-1 dialects/);

console.log('NuBloxSQL Tier-1 compatibility, matrix and migration-surface contracts: PASS');
