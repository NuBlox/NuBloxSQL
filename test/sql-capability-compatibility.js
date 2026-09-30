'use strict';

var assert = require('assert');
var sql = require('..');
var model = sql.capabilityModel;

var lateralPgToMysql = model.compatibility('postgresql', 'mysql', 'queries.joins.lateral');
assert.strictEqual(lateralPgToMysql.from, 'postgresql');
assert.strictEqual(lateralPgToMysql.to, 'mysql');
assert.strictEqual(lateralPgToMysql.compatible, true);
assert.strictEqual(lateralPgToMysql.level, 'exact');
assert.strictEqual(lateralPgToMysql.lossless, true);
assert.ok(Object.isFrozen(lateralPgToMysql));
assert.ok(Object.isFrozen(lateralPgToMysql.reasons));

var lateralPgToSqlite = model.compatibility('postgresql', 'sqlite', 'queries.joins.lateral');
assert.strictEqual(lateralPgToSqlite.compatible, false);
assert.strictEqual(lateralPgToSqlite.level, 'unsupported');
assert.strictEqual(lateralPgToSqlite.lossless, false);
assert.ok(lateralPgToSqlite.reasons.some(function (entry) { return entry.code === 'target-unsupported'; }));

var sqliteJsonToPg = model.compatibility('sqlite', 'postgresql', 'expressions.json');
assert.strictEqual(sqliteJsonToPg.compatible, null);
assert.strictEqual(sqliteJsonToPg.level, 'runtime-dependent');
assert.ok(sqliteJsonToPg.reasons.some(function (entry) { return entry.code === 'source-runtime-dependent'; }));

var sourceUnavailable = model.compatibility('mysql', 'postgresql', 'schema.materializedView');
assert.strictEqual(sourceUnavailable.compatible, null);
assert.strictEqual(sourceUnavailable.level, 'source-unavailable');

var queryPaths = model.paths('queries');
assert.ok(queryPaths.length > 10);
assert.ok(queryPaths.indexOf('queries.joins.lateral') >= 0);
assert.ok(Object.isFrozen(queryPaths));

var schemaComparison = model.compareCategory('schema');
assert.strictEqual(schemaComparison.category, 'schema');
assert.deepStrictEqual(Array.from(schemaComparison.dialects), ['postgresql', 'mysql', 'sqlite']);
assert.ok(schemaComparison.rows.length > 10);
var materialized = schemaComparison.rows.find(function (row) { return row.path === 'schema.materializedView'; });
assert.ok(materialized);
assert.strictEqual(materialized.universallySupported, false);
assert.strictEqual(materialized.dialects.postgresql.supported, true);
assert.strictEqual(materialized.dialects.mysql.supported, false);
assert.strictEqual(materialized.dialects.sqlite.supported, false);

var pgToMysqlQueries = model.migrationSurface('postgresql', 'mysql', 'queries');
assert.strictEqual(pgToMysqlQueries.from, 'postgresql');
assert.strictEqual(pgToMysqlQueries.to, 'mysql');
assert.strictEqual(pgToMysqlQueries.category, 'queries');
assert.ok(pgToMysqlQueries.capabilities.length > 10);
assert.strictEqual(
  pgToMysqlQueries.summary.exact + pgToMysqlQueries.summary.equivalent + pgToMysqlQueries.summary.emulated +
  pgToMysqlQueries.summary.partial + pgToMysqlQueries.summary.runtimeDependent + pgToMysqlQueries.summary.unsupported +
  pgToMysqlQueries.summary.notApplicable + pgToMysqlQueries.summary.unknown,
  pgToMysqlQueries.capabilities.length
);
assert.ok(pgToMysqlQueries.summary.exact > 0);

var pgToSqliteAll = model.migrationSurface('postgresql', 'sqlite');
assert.ok(pgToSqliteAll.capabilities.length > pgToMysqlQueries.capabilities.length);
assert.ok(pgToSqliteAll.summary.unsupported > 0);
assert.ok(pgToSqliteAll.summary.runtimeDependent > 0);
assert.ok(Object.isFrozen(pgToSqliteAll.summary));
assert.ok(Object.isFrozen(pgToSqliteAll.capabilities));

assert.throws(function () { model.compatibility('postgresql', 'sqlite', ''); }, /non-empty/);
assert.throws(function () { model.paths('not-a-category'); }, /Unknown SQL capability category/);
assert.throws(function () { model.compareCategory('queries', []); }, /at least one dialect/);
assert.throws(function () { model.migrationSurface('sqlserver', 'postgresql'); }, /Tier-1 dialects/);

console.log('NuBloxSQL Tier-1 compatibility and migration-surface contracts: PASS');
