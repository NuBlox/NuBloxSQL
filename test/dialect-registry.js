'use strict';

var assert = require('assert');
var sql = require('..');

assert.strictEqual(sql.DIALECT_REGISTRY_SCHEMA_VERSION, 1);
assert.strictEqual(sql.DIALECT_REGISTRY_MASTER_PROFILE_COUNT, 100);
assert.strictEqual(sql.capabilityModel.dialectRegistry, sql.dialectRegistry);

var validation = sql.dialectRegistry.validate();
assert.strictEqual(validation.valid, true);
assert.deepStrictEqual(validation.errors, []);
assert.strictEqual(validation.masterProfiles, 100);
assert.strictEqual(validation.dialectDefinitions, 101);
assert.strictEqual(validation.firstClassDialects, 25);

var report = sql.dialectRegistry.report();
assert.strictEqual(report.counts.masterProfiles, 100);
assert.strictEqual(report.counts.dialectDefinitions, 101);
assert.strictEqual(report.counts.firstClassDialects, 25);
assert.strictEqual(report.counts.routableProducts, 4);
assert.deepStrictEqual(Array.from(sql.PRIMARY_SQL_DIALECTS), [
  'ansi','mysql','mariadb','postgresql','cockroachdb','yugabytedb','sqlserver',
  'oracle','db2','sqlite','duckdb','firebird','snowflake','bigquery','redshift',
  'teradata','spark','databricks','hive','trino','presto','clickhouse','hana',
  'informix','sybase-ase'
]);

var ordinals = sql.dialectRegistry.products.map(function (entry) { return entry.source.registryOrdinal; });
assert.deepStrictEqual(ordinals, Array.from({ length: 100 }, function (_, index) { return index + 1; }));

sql.dialectRegistry.products.forEach(function (entry) {
  assert.ok(entry.vendor);
  assert.ok(entry.product);
  assert.ok(entry.dialect);
  assert.ok(entry.versions);
  assert.ok(entry.driver);
  assert.ok(entry.wireProtocol);
  assert.ok(entry.compatibility);
  ['capabilities','dataTypes','operators','functions','ddl','dml','dcl','tcl','proceduralLanguage'].forEach(function (key) {
    assert.ok(Object.prototype.hasOwnProperty.call(entry.language, key), entry.id + ' missing language surface ' + key);
  });
  assert.ok(Object.isFrozen(entry));
});

var postgresql = sql.dialectRegistry.product('postgresql');
assert.strictEqual(postgresql.driver.routable, true);
assert.strictEqual(postgresql.driver.adapter, 'postgresql');
assert.deepStrictEqual(Array.from(postgresql.versions.qualified), ['15','16','17','18']);
assert.strictEqual(postgresql.language.capabilities, 'modelled');

var mysql = sql.dialectRegistry.product('mysql');
assert.strictEqual(mysql.wireProtocol.family, 'mysql-classic');
assert.deepStrictEqual(Array.from(mysql.versions.qualified), ['8.4','9.7']);

var sqlserver = sql.dialectRegistry.product('mssql');
assert.strictEqual(sqlserver.id, 'sqlserver');
assert.strictEqual(sqlserver.driver.routable, true);
assert.strictEqual(sqlserver.language.capabilities, 'partial');

var aurora = sql.dialectRegistry.product('aurora-postgresql');
assert.strictEqual(aurora.profileDialect, 'aurora-postgresql');
assert.strictEqual(aurora.dialect, 'postgresql');
assert.strictEqual(aurora.parentDialect, 'postgresql');
assert.strictEqual(aurora.primaryDialect, 'postgresql');
assert.strictEqual(aurora.driver.routable, false);
assert.strictEqual(aurora.driver.candidateAdapter, 'postgresql');
assert.strictEqual(aurora.driver.capabilityModel, 'inherited-unverified');
assert.strictEqual(aurora.wireProtocol.status, 'compatibility-unverified');

var spannerPostgres = sql.dialectRegistry.dialect('spanner-postgresql');
assert.strictEqual(spannerPostgres.kind, 'compatibility-interface');
assert.strictEqual(spannerPostgres.parentDialect, 'postgresql');

var bigqueryLegacy = sql.dialectRegistry.product('bigquery-legacy');
assert.strictEqual(bigqueryLegacy.profileDialect, 'bigquery-legacy');
assert.strictEqual(bigqueryLegacy.dialect, 'bigquery');
assert.strictEqual(bigqueryLegacy.parentDialect, 'bigquery');
assert.strictEqual(bigqueryLegacy.driver.routable, false);

var plsql = sql.dialectRegistry.product('oracle-plsql');
assert.strictEqual(plsql.proceduralLanguage, 'PL/SQL');
assert.strictEqual(plsql.parentDialect, 'oracle');

assert.deepStrictEqual(
  sql.dialectRegistry.ancestry('memsql-legacy').map(function (entry) { return entry.id; }),
  ['memsql-legacy','singlestore','mysql']
);

var pgProducts = sql.dialectRegistry.productsForDialect('postgresql', { includeDescendants: true });
['postgresql','greenplum','aurora-postgresql','timescaledb','spanner-postgresql','opengauss'].forEach(function (id) {
  assert.ok(pgProducts.some(function (entry) { return entry.id === id; }), 'PostgreSQL descendants missing ' + id);
});

assert.ok(sql.dialectRegistry.dialect('db2'));
assert.strictEqual(sql.dialectRegistry.product('db2'), null);
assert.strictEqual(sql.dialectRegistry.resolve('not-a-real-dialect'), null);
assert.throws(function () { sql.createClient({ dialect: 'aurora-postgresql', user: 'test' }); }, /Unsupported NuBloxSQL dialect/);

console.log('NuBloxSQL canonical dialect registry contract: PASS');
