'use strict';

var assert = require('assert');
var sql = require('..');

assert.strictEqual(sql.DATABASE_BOOTSTRAP_PLAN_SCHEMA_VERSION, 1);
assert.strictEqual(sql.DATABASE_BOOTSTRAP_EXECUTION_SCHEMA_VERSION, 1);
assert.deepStrictEqual(Array.from(sql.DATABASE_BOOTSTRAP_EXECUTION_MODES), ['automatic','manual','satisfied']);
assert.deepStrictEqual(Array.from(sql.DATABASE_BOOTSTRAP_SCOPES), ['server','database']);

var pg = sql.planDatabaseBootstrap({
  database: 'release_bootstrap',
  schemas: ['app']
}, { targetDialect: 'postgresql' });

assert.strictEqual(pg.targetDialect, 'postgresql');
assert.strictEqual(pg.summary.steps, 2);
assert.strictEqual(pg.summary.automatic, 2);
assert.strictEqual(pg.requires.databaseClientAfterCreate, true);
assert.strictEqual(pg.requires.autocommitBoundary, true);
assert.strictEqual(pg.steps[0].scope, 'server');
assert.strictEqual(pg.steps[1].scope, 'database');
assert.strictEqual(pg.steps[0].requirements.transactionForbidden, true);
assert.strictEqual(pg.steps[0].requirements.reconnectAfter, true);
assert.strictEqual(pg.planHash.length, 64);

var mysql = sql.planDatabaseBootstrap({
  database: 'release_bootstrap',
  schemas: ['release_bootstrap','analytics']
}, { targetDialect: 'mysql' });
assert.strictEqual(mysql.summary.satisfied, 1);
assert.strictEqual(mysql.steps[1].execution, 'satisfied');
assert.strictEqual(mysql.steps[2].scope, 'server');
assert.strictEqual(mysql.steps[2].requirements.databaseEquivalent, true);

var configured = sql.planDatabaseBootstrap({
  database: {
    name: 'configured_release',
    options: {
      owner: 'app_owner',
      encoding: 'UTF8',
      collation: 'en_GB.UTF-8'
    }
  }
}, { targetDialect: 'postgresql' });
assert.strictEqual(configured.steps[0].sql, 'CREATE DATABASE "configured_release" WITH OWNER = "app_owner" ENCODING = \'UTF8\' LC_COLLATE = \'en_GB.UTF-8\'');

var sqlserver = sql.planDatabaseBootstrap({
  database: 'release_bootstrap',
  schemas: ['app']
}, { targetDialect: 'sqlserver' });
assert.strictEqual(sqlserver.steps[0].requirements.onlyStatementBatch, true);
assert.strictEqual(sqlserver.steps[0].requirements.transactionForbidden, true);
assert.strictEqual(sqlserver.requires.databaseClientAfterCreate, true);

var sqlite = sql.planDatabaseBootstrap({
  database: 'release.db',
  schemas: ['aux']
}, { targetDialect: 'sqlite' });
assert.strictEqual(sqlite.steps[0].execution, 'satisfied');
assert.strictEqual(sqlite.steps[1].execution, 'manual');
assert.strictEqual(sqlite.executable, false);

assert.strictEqual(sql.productCoverage.area('administration.bootstrap').status, 'partial');
assert.strictEqual(sql.productCoverage.area('administration.bootstrap').stages.publicApi, 'implemented');
assert.strictEqual(sql.productCoverage.area('administration.bootstrap').stages.runtime, 'implemented');
assert.strictEqual(sql.productCoverage.area('administration.bootstrap').stages.liveQualification, 'partial');

console.log('NuBloxSQL database bootstrap release qualification: PASS');
