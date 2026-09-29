'use strict';

var assert = require('assert');
var postgres = require('..');

function connectionConfig() {
  return {
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'postgres',
    ssl: false,
    connectTimeout: 10000,
    cancelTimeout: 3000,
    cancelGraceTimeout: 3000
  };
}

async function main() {
  var connection = postgres.createConnection(connectionConfig());

  await connection.connect();
  assert.strictEqual(connection.connected, true);
  assert.ok(connection.parameters.server_version);
  assert.ok(connection.backendKeyData && connection.backendKeyData.processId > 0);

  var result = await connection.query("SELECT 1::int4 AS answer, true AS ok, '{\"a\":1}'::jsonb AS payload, NULL::text AS missing");
  assert.strictEqual(result.command, 'SELECT 1');
  assert.strictEqual(result.rowCount, 1);
  assert.strictEqual(result.rows.length, 1);
  assert.strictEqual(result.rows[0].answer, 1);
  assert.strictEqual(result.rows[0].ok, true);
  assert.deepStrictEqual(result.rows[0].payload, { a: 1 });
  assert.strictEqual(result.rows[0].missing, null);

  await connection.query('CREATE TEMP TABLE nublox_rc_test(id int primary key, name text, active boolean, payload jsonb)');

  var statement = await connection.prepare(
    'INSERT INTO nublox_rc_test(id, name, active, payload) VALUES ($1, $2, $3, $4) RETURNING id, name, active, payload'
  );
  assert.ok(statement instanceof postgres.PreparedStatement);
  assert.strictEqual(statement.parameterTypeOids.length, 4);
  assert.strictEqual(statement.fields.length, 4);

  var first = await statement.execute([1, 'alpha', true, { source: 'prepared' }]);
  assert.strictEqual(first.rowCount, 1);
  assert.strictEqual(first.rows[0].id, 1);
  assert.strictEqual(first.rows[0].name, 'alpha');
  assert.strictEqual(first.rows[0].active, true);
  assert.deepStrictEqual(first.rows[0].payload, { source: 'prepared' });

  var second = await statement.execute([2, 'beta', false, { source: 'repeat' }]);
  assert.strictEqual(second.rows[0].id, 2);
  assert.strictEqual(second.rows[0].active, false);
  await statement.close();
  assert.strictEqual(statement.closed, true);
  await assert.rejects(statement.execute([3, 'closed', true, {}]), /closed/);

  var convenience = await connection.execute(
    'SELECT $1::int4 AS id, $2::text AS name, $3::boolean AS active',
    [3, 'gamma', true]
  );
  assert.strictEqual(convenience.rows[0].id, 3);
  assert.strictEqual(convenience.rows[0].name, 'gamma');
  assert.strictEqual(convenience.rows[0].active, true);

  await assert.rejects(connection.query('SELECT pg_sleep(5)', { timeout: 100 }), function (error) {
    return error instanceof postgres.PostgreSqlCancellationError && error.code === 'NUBLOX_POSTGRESQL_TIMEOUT';
  });
  assert.strictEqual(connection.connected, true);
  assert.strictEqual(connection.ended, false);
  var afterTimeout = await connection.query('SELECT 11::int4 AS value');
  assert.strictEqual(afterTimeout.rows[0].value, 11);

  var explicitPending = connection.query('SELECT pg_sleep(5)');
  var explicitCancel = new Promise(function (resolve, reject) {
    setTimeout(function () { connection.cancel().then(resolve, reject); }, 100);
  });
  await assert.rejects(explicitPending, function (error) {
    return error instanceof postgres.PostgreSqlCancellationError && error.code === 'NUBLOX_POSTGRESQL_CANCELLED';
  });
  await explicitCancel;
  assert.strictEqual(connection.connected, true);
  assert.strictEqual(connection.ended, false);
  var afterExplicitCancel = await connection.query('SELECT 13::int4 AS value');
  assert.strictEqual(afterExplicitCancel.rows[0].value, 13);

  var controller = new AbortController();
  var pending = connection.query('SELECT pg_sleep(5)', { signal: controller.signal });
  setTimeout(function () { controller.abort(new Error('live PostgreSQL abort')); }, 100);
  await assert.rejects(pending, /live PostgreSQL abort/);
  assert.strictEqual(connection.connected, true);
  assert.strictEqual(connection.ended, false);
  var afterAbort = await connection.query('SELECT 12::int4 AS value');
  assert.strictEqual(afterAbort.rows[0].value, 12);

  var rows = await connection.query('SELECT id, name, active FROM nublox_rc_test ORDER BY id');
  assert.deepStrictEqual(rows.rows.map(function (row) { return [row.id, row.name, row.active]; }), [[1, 'alpha', true], [2, 'beta', false]]);

  await connection.beginTransaction();
  var cursorStatement = await connection.prepare('SELECT generate_series(1, 7)::int4 AS value');
  var cursor = cursorStatement.openCursor([], { batchSize: 3 });
  var batch1 = await cursor.fetch();
  assert.deepStrictEqual(batch1.rows.map(function (row) { return row.value; }), [1, 2, 3]);
  assert.strictEqual(batch1.done, false);
  var batch2 = await cursor.fetch();
  assert.deepStrictEqual(batch2.rows.map(function (row) { return row.value; }), [4, 5, 6]);
  assert.strictEqual(batch2.done, false);
  var batch3 = await cursor.fetch();
  assert.deepStrictEqual(batch3.rows.map(function (row) { return row.value; }), [7]);
  assert.strictEqual(batch3.done, true);
  await cursor.close();
  await cursorStatement.close();
  await connection.commit();

  await connection.beginTransaction();
  var iteratorStatement = await connection.prepare('SELECT generate_series(1, 10)::int4 AS value');
  var iteratorCursor = iteratorStatement.openCursor([], { batchSize: 2 });
  var seen = [];
  for await (var cursorRow of iteratorCursor) {
    seen.push(cursorRow.value);
    if (seen.length === 3) break;
  }
  assert.deepStrictEqual(seen, [1, 2, 3]);
  assert.strictEqual(iteratorCursor.closed, true);
  await iteratorStatement.close();
  await connection.commit();

  await connection.query('DROP TABLE IF EXISTS nublox_pool_tx_test');
  await connection.query('CREATE TABLE nublox_pool_tx_test(id int primary key)');

  var pool = postgres.createPool(Object.assign(connectionConfig(), {
    connectionLimit: 1,
    maxIdle: 1,
    idleTimeout: 0,
    acquireTimeout: 3000
  }));

  var borrower = await pool.getConnection();
  var pooledProcessId = borrower.backendKeyData.processId;
  await borrower.query('CREATE TEMP TABLE nublox_pool_leak(value int)');
  await borrower.query("SET application_name = 'borrower-leak'");
  await pool.releaseConnection(borrower);
  assert.strictEqual(pool.idleCount, 1);

  var reused = await pool.getConnection();
  assert.strictEqual(reused.backendKeyData.processId, pooledProcessId);
  var cleared = await reused.query("SELECT to_regclass('pg_temp.nublox_pool_leak') IS NULL AS cleared, current_setting('application_name') <> 'borrower-leak' AS app_reset");
  assert.strictEqual(cleared.rows[0].cleared, true);
  assert.strictEqual(cleared.rows[0].app_reset, true);
  await pool.releaseConnection(reused);

  await pool.withTransaction(async function (tx) {
    await tx.query('INSERT INTO nublox_pool_tx_test(id) VALUES (1)');
    await tx.savepoint('before_second');
    await tx.query('INSERT INTO nublox_pool_tx_test(id) VALUES (2)');
    await tx.rollbackToSavepoint('before_second');
    await tx.releaseSavepoint('before_second');
  }, { isolationLevel: 'serializable', readOnly: false });

  var committed = await connection.query('SELECT id FROM nublox_pool_tx_test ORDER BY id');
  assert.deepStrictEqual(committed.rows.map(function (row) { return row.id; }), [1]);

  await assert.rejects(pool.withTransaction(async function (tx) {
    await tx.query('INSERT INTO nublox_pool_tx_test(id) VALUES (3)');
    throw new Error('force transaction rollback');
  }), /force transaction rollback/);
  var rolledBack = await connection.query('SELECT id FROM nublox_pool_tx_test ORDER BY id');
  assert.deepStrictEqual(rolledBack.rows.map(function (row) { return row.id; }), [1]);

  var portalBorrower = await pool.getConnection();
  await portalBorrower.beginTransaction();
  var pooledCursorStatement = await portalBorrower.prepare('SELECT generate_series(1, 4)::int4 AS value');
  var pooledCursor = pooledCursorStatement.openCursor([], { batchSize: 2 });
  var pooledFirstBatch = await pooledCursor.fetch();
  assert.deepStrictEqual(pooledFirstBatch.rows.map(function (row) { return row.value; }), [1, 2]);
  await assert.rejects(pool.releaseConnection(portalBorrower), /active portal cursors/);
  await pooledCursor.close();
  await pooledCursorStatement.close();
  await portalBorrower.rollback();
  await pool.releaseConnection(portalBorrower);

  await pool.end();
  await connection.query('DROP TABLE nublox_pool_tx_test');
  await connection.end();
}

main().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
