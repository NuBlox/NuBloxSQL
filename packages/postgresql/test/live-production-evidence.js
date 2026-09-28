'use strict';

var assert = require('assert');
var performance = require('perf_hooks').performance;
var postgresql = require('..');

function config(overrides) {
  return Object.assign({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'nublox',
    password: process.env.PGPASSWORD || 'nublox_ci_password',
    database: process.env.PGDATABASE || 'nublox',
    ssl: 'disable',
    connectTimeout: 5000
  }, overrides || {});
}

function elapsed(start) { return Math.max(0.001, performance.now() - start); }
function rate(count, milliseconds) { return Number((count / (milliseconds / 1000)).toFixed(2)); }

async function simpleQueryEvidence(metrics) {
  var connection = postgresql.createConnection(config());
  await connection.connect();
  var count = 250;
  var started = performance.now();
  for (var i = 0; i < count; i++) {
    var result = await connection.query('SELECT 1::int4 AS value');
    assert.strictEqual(result.rows[0].value, 1);
  }
  var milliseconds = elapsed(started);
  metrics.simpleQuery = { operations: count, milliseconds: Number(milliseconds.toFixed(2)), operationsPerSecond: rate(count, milliseconds) };
  await connection.end();
}

async function preparedEvidence(metrics) {
  var connection = postgresql.createConnection(config());
  await connection.connect();
  var statement = await connection.prepare('SELECT $1::int4 AS value');
  var count = 250;
  var started = performance.now();
  for (var i = 0; i < count; i++) {
    var result = await statement.execute([i]);
    assert.strictEqual(result.rows[0].value, i);
  }
  var milliseconds = elapsed(started);
  metrics.prepared = { operations: count, milliseconds: Number(milliseconds.toFixed(2)), operationsPerSecond: rate(count, milliseconds) };
  await statement.close();
  await connection.end();
}

async function poolContentionEvidence(metrics) {
  var pool = postgresql.createPool(config({ connectionLimit: 4, maxIdle: 4, acquireTimeout: 5000 }));
  var count = 120;
  var started = performance.now();
  var work = [];
  for (var i = 0; i < count; i++) work.push(pool.query('SELECT 1::int4 AS value'));
  var results = await Promise.all(work);
  results.forEach(function (result) { assert.strictEqual(result.rows[0].value, 1); });
  var milliseconds = elapsed(started);
  assert.ok(pool.totalCount <= 4, 'pool must respect connectionLimit');
  assert.strictEqual(pool.borrowedCount, 0, 'all pooled connections must be released');
  assert.strictEqual(pool.waitingCount, 0, 'pool wait queue must drain');
  metrics.pool = {
    operations: count,
    milliseconds: Number(milliseconds.toFixed(2)),
    operationsPerSecond: rate(count, milliseconds),
    totalConnections: pool.totalCount,
    idleConnections: pool.idleCount
  };
  await pool.end();
}

async function portalEvidence(metrics) {
  var connection = postgresql.createConnection(config());
  await connection.connect();
  await connection.beginTransaction();
  var statement = await connection.prepare('SELECT generate_series(1, 5000)::int4 AS value');
  var cursor = statement.openCursor([], { batchSize: 128 });
  var count = 0;
  var started = performance.now();
  for await (var row of cursor) {
    count += 1;
    assert.strictEqual(row.value, count);
  }
  var milliseconds = elapsed(started);
  assert.strictEqual(count, 5000);
  await cursor.close();
  await statement.close();
  await connection.rollback();
  metrics.portal = { rows: count, batchSize: 128, milliseconds: Number(milliseconds.toFixed(2)), rowsPerSecond: rate(count, milliseconds) };
  await connection.end();
}

async function memorySoakEvidence(metrics) {
  if (typeof global.gc !== 'function') throw new Error('production evidence requires Node --expose-gc');
  var connection = postgresql.createConnection(config());
  await connection.connect();
  global.gc();
  var before = process.memoryUsage().heapUsed;
  var iterations = 600;
  for (var i = 0; i < iterations; i++) {
    var result = await connection.query("SELECT " + i + "::int4 AS id, repeat('x', 128)::text AS payload");
    assert.strictEqual(result.rows[0].id, i);
  }
  global.gc();
  var after = process.memoryUsage().heapUsed;
  var growth = Math.max(0, after - before);
  var maximumGrowth = 64 * 1024 * 1024;
  assert.ok(growth < maximumGrowth, 'heap growth after forced GC exceeded 64 MiB: ' + growth);
  metrics.memorySoak = { iterations: iterations, beforeHeapBytes: before, afterHeapBytes: after, retainedGrowthBytes: growth, maximumGrowthBytes: maximumGrowth };
  await connection.end();
}

async function cancellationRecoveryEvidence(metrics) {
  var connection = postgresql.createConnection(config({ cancelGraceTimeout: 2000 }));
  await connection.connect();
  var started = performance.now();
  await assert.rejects(connection.query('SELECT pg_sleep(5)', { timeout: 100 }), function (error) {
    return error && (error.code === 'NUBLOX_POSTGRESQL_CANCELLED' || /cancel|timeout|timed out/i.test(error.message));
  });
  var milliseconds = elapsed(started);
  assert.strictEqual(connection.connected, true, 'successful CancelRequest should keep connection usable');
  var result = await connection.query('SELECT 1::int4 AS ok');
  assert.strictEqual(result.rows[0].ok, 1);
  metrics.cancellation = { milliseconds: Number(milliseconds.toFixed(2)), connectionRecovered: true };
  await connection.end();
}

async function run() {
  var metrics = {
    postgresqlMajor: process.env.PG_EXPECTED_MAJOR ? Number(process.env.PG_EXPECTED_MAJOR) : null,
    node: process.version
  };
  await simpleQueryEvidence(metrics);
  await preparedEvidence(metrics);
  await poolContentionEvidence(metrics);
  await portalEvidence(metrics);
  await cancellationRecoveryEvidence(metrics);
  await memorySoakEvidence(metrics);
  console.log('NUBLOX_POSTGRESQL_PRODUCTION_EVIDENCE ' + JSON.stringify(metrics));
}

run().catch(function (error) {
  console.error(error.stack || error);
  process.exit(1);
});
