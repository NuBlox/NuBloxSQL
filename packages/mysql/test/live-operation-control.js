'use strict';

var assert = require('assert');
var mysql = require('..');

function config() {
  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE,
    ssl: 'disable'
  };
}

async function expiredDeadlineKeepsConnectionUsable() {
  var connection = mysql.createConnection(config());
  await connection.connect();
  await assert.rejects(connection.query('SELECT 1', { deadline: Date.now() - 1 }), function (error) {
    return error instanceof mysql.MySqlClientError &&
      error.code === mysql.ERROR_CODES.TIMEOUT &&
      error.category === 'timeout' &&
      error.cause && error.cause.code === 'NUBLOX_MYSQL_DEADLINE_EXCEEDED';
  });
  var result = await connection.query('SELECT 1 AS ok');
  assert.strictEqual(Number(result.rows[0].ok), 1);
  await connection.end();
}

async function inFlightTimeoutDestroysConnection() {
  var connection = mysql.createConnection(config());
  await connection.connect();
  await assert.rejects(connection.query('SELECT SLEEP(1)', { timeout: 100 }), function (error) {
    return error instanceof mysql.MySqlClientError && error.code === mysql.ERROR_CODES.TIMEOUT;
  });
  assert.strictEqual(connection.ended, true);
}

async function inFlightAbortDestroysConnection() {
  var connection = mysql.createConnection(config());
  await connection.connect();
  var controller = new AbortController();
  var pending = connection.query('SELECT SLEEP(1)', { signal: controller.signal });
  setTimeout(function () { controller.abort(new Error('live cancellation')); }, 100);
  await assert.rejects(pending, function (error) {
    return error instanceof mysql.MySqlClientError && error.code === mysql.ERROR_CODES.ABORTED;
  });
  assert.strictEqual(connection.ended, true);
}

async function poolTimeoutCoversAcquisition() {
  var pool = mysql.createPool(Object.assign(config(), { connectionLimit: 1, acquireTimeout: 5000, resetOnRelease: false }));
  var held = await pool.getConnection();
  var started = Date.now();
  await assert.rejects(pool.query('SELECT 1', { timeout: 150 }), function (error) {
    return error instanceof mysql.MySqlClientError && error.code === mysql.ERROR_CODES.POOL_ACQUIRE_TIMEOUT;
  });
  var elapsed = Date.now() - started;
  assert.ok(elapsed < 1500, 'pool operation timeout must include acquisition time');
  pool.releaseConnection(held);
  await pool.end();
}

Promise.resolve()
  .then(expiredDeadlineKeepsConnectionUsable)
  .then(inFlightTimeoutDestroysConnection)
  .then(inFlightAbortDestroysConnection)
  .then(poolTimeoutCoversAcquisition)
  .then(function () { console.log('ok - live clean-room deadline/cancellation safety'); })
  .catch(function (error) {
    console.error(error.stack || error);
    process.exit(1);
  });
