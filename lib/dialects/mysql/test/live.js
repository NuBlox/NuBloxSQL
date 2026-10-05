'use strict';

var assert = require('assert');
var mysql = require('..');

function config() {
  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'nublox',
    password: process.env.MYSQL_PASSWORD || 'nublox_ci_password',
    database: process.env.MYSQL_DATABASE || 'nublox_ci',
    ssl: 'disable',
    getServerPublicKey: true,
    connectTimeout: 15000
  };
}

function stage(name) {
  process.stdout.write('[cleanroom-live] ' + name + '\n');
}

async function collect(stream) {
  var rows = [];
  for await (var row of stream) rows.push(row);
  return rows;
}

async function main() {
  stage('direct:connect');
  var connection = mysql.createConnection(Object.assign(config(), { connectionAttributes: { nublox_suite: 'live-mysql' } }));

  await connection.connect();
  assert.strictEqual(connection.connected, true);
  assert.ok(connection.server);
  assert.strictEqual(connection.server.authPluginName, 'caching_sha2_password');

  stage('direct:connection-attributes');
  var attrResult = await connection.query(
    'SELECT ATTR_NAME AS attr_name, ATTR_VALUE AS attr_value ' +
    'FROM performance_schema.session_connect_attrs ' +
    'WHERE PROCESSLIST_ID = CONNECTION_ID()'
  );
  var attrs = {};
  attrResult.rows.forEach(function (row) { attrs[row.attr_name] = row.attr_value; });
  assert.strictEqual(attrs._client_name, 'nubloxsql');
  assert.strictEqual(attrs._client_version, connection.connectionAttributes._client_version);
  assert.strictEqual(attrs.program_name, 'nubloxsql');
  assert.strictEqual(attrs.nublox_suite, 'live-mysql');

  stage('direct:buffered-query');
  var first = await connection.query("SELECT 1 AS one, 'NuBlox' AS name");
  assert.strictEqual(first.rows.length, 1);
  assert.strictEqual(first.rows[0].one, '1');
  assert.strictEqual(first.rows[0].name, 'NuBlox');

  await connection.query('CREATE TEMPORARY TABLE nublox_cleanroom_live (id BIGINT PRIMARY KEY, name VARCHAR(64) NOT NULL, score DOUBLE NULL)');
  var inserted = await connection.query("INSERT INTO nublox_cleanroom_live (id, name, score) VALUES (2, 'beta', 2.5), (1, 'alpha', NULL)");
  assert.strictEqual(Number(inserted.affectedRows), 2);

  var selected = await connection.query('SELECT id, name FROM nublox_cleanroom_live ORDER BY id');
  assert.deepStrictEqual(selected.rows.map(function (row) { return [row.id, row.name]; }), [['1', 'alpha'], ['2', 'beta']]);

  stage('direct:stream:start');
  var fieldCount = 0;
  var streamed = connection.queryStream('SELECT id, name FROM nublox_cleanroom_live ORDER BY id', {
    highWaterMark: 1,
    maxRows: 10,
    maxResultBytes: 1024 * 1024,
    maxRowBytes: 1024
  });
  streamed.on('fields', function (fields) { fieldCount = fields.length; });
  var streamedRows = await collect(streamed);
  stage('direct:stream:complete');
  assert.deepStrictEqual(streamedRows.map(function (row) { return [row.id, row.name]; }), [['1', 'alpha'], ['2', 'beta']]);
  assert.strictEqual(fieldCount, 2);
  assert.strictEqual(streamed.rowCount, 2);
  assert.ok(streamed.byteCount > 0);

  stage('direct:prepared');
  var selectStatement = await connection.prepare('SELECT ? AS n, ? AS label, ? AS nullable_value');
  assert.strictEqual(selectStatement.parameterCount, 3);
  assert.strictEqual(selectStatement.columnCount, 3);
  var preparedSelected = await selectStatement.execute([42, 'prepared', null]);
  assert.strictEqual(preparedSelected.rows.length, 1);
  assert.strictEqual(preparedSelected.rows[0].n, 42);
  assert.strictEqual(preparedSelected.rows[0].label, 'prepared');
  assert.strictEqual(preparedSelected.rows[0].nullable_value, null);
  await selectStatement.reset();
  var selectedAgain = await selectStatement.execute([84n, 'again', 'value']);
  assert.strictEqual(selectedAgain.rows[0].n, 84);
  assert.strictEqual(selectedAgain.rows[0].label, 'again');
  assert.strictEqual(selectedAgain.rows[0].nullable_value, 'value');
  await selectStatement.close();

  var insertStatement = await connection.prepare('INSERT INTO nublox_cleanroom_live (id, name, score) VALUES (?, ?, ?)');
  var preparedInsert = await insertStatement.execute([3, 'gamma', 3.75]);
  assert.strictEqual(Number(preparedInsert.affectedRows), 1);
  await insertStatement.close();

  stage('direct:transaction');
  await connection.beginTransaction({ isolationLevel: 'read-committed' });
  await connection.query("INSERT INTO nublox_cleanroom_live (id, name, score) VALUES (4, 'rollback', 4.0)");
  await connection.rollback();
  var rolledBack = await connection.query('SELECT COUNT(*) AS count_value FROM nublox_cleanroom_live WHERE id = 4');
  assert.strictEqual(rolledBack.rows[0].count_value, '0');

  var txValue = await connection.withTransaction(async function (tx) {
    await tx.query("INSERT INTO nublox_cleanroom_live (id, name, score) VALUES (5, 'commit', 5.0)");
    await tx.savepoint('after_insert');
    await tx.query("UPDATE nublox_cleanroom_live SET name = 'changed' WHERE id = 5");
    await tx.rollbackToSavepoint('after_insert');
    await tx.releaseSavepoint('after_insert');
    return 'committed';
  });
  assert.strictEqual(txValue, 'committed');
  var committed = await connection.query('SELECT name FROM nublox_cleanroom_live WHERE id = 5');
  assert.strictEqual(committed.rows[0].name, 'commit');

  stage('direct:session-reset');
  await connection.query("SET @nublox_reset_marker = 'dirty'");
  await connection.resetSession();
  var resetMarker = await connection.query('SELECT @nublox_reset_marker AS marker');
  assert.strictEqual(resetMarker.rows[0].marker, null);

  await connection.end();
  stage('direct:complete');

  stage('pool:basic:start');
  var poolConfig = Object.assign(config(), { connectionLimit: 2, maxIdle: 2, idleTimeout: 30000, acquireTimeout: 5000 });
  var pool = mysql.createPool(poolConfig);
  var concurrent = await Promise.all([
    pool.query('SELECT 11 AS value_one'),
    pool.query('SELECT 22 AS value_two'),
    pool.query('SELECT 33 AS value_three')
  ]);
  assert.strictEqual(concurrent[0].rows[0].value_one, '11');
  assert.strictEqual(concurrent[1].rows[0].value_two, '22');
  assert.strictEqual(concurrent[2].rows[0].value_three, '33');
  assert.ok(pool.totalCount <= 2);

  var poolPrepared = await pool.execute('SELECT ? AS pooled_value', [123]);
  assert.strictEqual(poolPrepared.rows[0].pooled_value, 123);

  var pooledTransaction = await pool.withTransaction(async function (tx) {
    var result = await tx.query("SELECT 'transaction' AS mode");
    return result.rows[0].mode;
  });
  assert.strictEqual(pooledTransaction, 'transaction');
  assert.strictEqual(pool.waitingCount, 0);
  await pool.end();
  assert.strictEqual(pool.totalCount, 0);
  stage('pool:basic:complete');

  stage('pool:stream:start');
  var streamPool = mysql.createPool(Object.assign(config(), { connectionLimit: 1, maxIdle: 1, idleTimeout: 30000, acquireTimeout: 5000 }));
  var pooledStream = await streamPool.queryStream('SELECT 101 AS streamed_value UNION ALL SELECT 102 AS streamed_value ORDER BY streamed_value', { highWaterMark: 1 });
  var pooledRows = await collect(pooledStream);
  stage('pool:stream:consumed');
  assert.deepStrictEqual(pooledRows.map(function (row) { return row.streamed_value; }), ['101', '102']);
  var afterStream = await streamPool.query('SELECT 103 AS after_stream');
  assert.strictEqual(afterStream.rows[0].after_stream, '103');
  await streamPool.end();
  stage('pool:stream:complete');

  stage('pool:isolation:start');
  var isolationPool = mysql.createPool(Object.assign(config(), { connectionLimit: 1, maxIdle: 1, idleTimeout: 30000, acquireTimeout: 5000 }));
  var resetEvents = 0;
  isolationPool.on('reset', function () { resetEvents++; });
  var dirty = await isolationPool.getConnection();
  await dirty.query("SET @nublox_pool_marker = 'borrower-one'");
  isolationPool.releaseConnection(dirty);
  var clean = await isolationPool.getConnection();
  var cleanMarker = await clean.query('SELECT @nublox_pool_marker AS marker');
  assert.strictEqual(cleanMarker.rows[0].marker, null);
  assert.ok(resetEvents >= 1);
  isolationPool.releaseConnection(clean);
  await isolationPool.end();
  stage('pool:isolation:complete');

  stage('limits:start');
  var limited = mysql.createConnection(config());
  await limited.connect();
  var limitStream = limited.queryStream('SELECT 1 AS n UNION ALL SELECT 2 AS n', { maxRows: 1 });
  await assert.rejects(async function () { await collect(limitStream); }, function (error) {
    return error instanceof mysql.MySqlResultLimitError && error.code === 'NUBLOX_MYSQL_MAX_ROWS';
  });
  assert.strictEqual(limited.ended, true);
  stage('limits:complete');

  process.stdout.write('clean-room MySQL live connection/query/streaming/prepared/transaction/pool/reset smoke passed\n');
}

main().catch(function (error) {
  process.stderr.write((error && error.stack) ? error.stack + '\n' : String(error) + '\n');
  process.exit(1);
});