'use strict';

var assert = require('assert');
var mysql = require('..');

function config() {
  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    connectionLimit: 1,
    acquireTimeout: 2000
  };
}

async function firstConnection(pool) {
  var connection = await pool.getConnection();
  pool.releaseConnection(connection);
  return connection;
}

async function assertReplacement(pool, poisoned) {
  assert.strictEqual(pool.totalCount, 0, 'poisoned connection must be removed from the pool');
  var replacement = await pool.getConnection();
  assert.notStrictEqual(replacement, poisoned, 'pool must create a new physical connection');
  var result = await replacement.query('SELECT 1 AS ok');
  assert.strictEqual(result.rows.length, 1);
  assert.strictEqual(result.rows[0].ok, '1');
  pool.releaseConnection(replacement);
}

async function testQueryTimeout() {
  var pool = mysql.createPool(config());
  try {
    var poisoned = await firstConnection(pool);
    await assert.rejects(
      pool.query('SELECT SLEEP(2) AS slept', { timeout: 50 }),
      function (error) {
        assert.ok(error instanceof mysql.MySqlClientError);
        assert.strictEqual(error.code, mysql.ERROR_CODES.TIMEOUT);
        assert.strictEqual(error.category, 'timeout');
        assert.strictEqual(error.retryable, true);
        return true;
      }
    );
    await assertReplacement(pool, poisoned);
  } finally {
    await pool.end();
  }
}

async function testQueryAbort() {
  var pool = mysql.createPool(config());
  try {
    var poisoned = await firstConnection(pool);
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(new Error('caller cancelled')); }, 50);
    try {
      await assert.rejects(
        pool.query('SELECT SLEEP(2) AS slept', { signal: controller.signal }),
        function (error) {
          assert.ok(error instanceof mysql.MySqlClientError);
          assert.strictEqual(error.code, mysql.ERROR_CODES.ABORTED);
          assert.strictEqual(error.category, 'cancelled');
          assert.strictEqual(error.cause.message, 'caller cancelled');
          return true;
        }
      );
    } finally {
      clearTimeout(timer);
    }
    await assertReplacement(pool, poisoned);
  } finally {
    await pool.end();
  }
}

async function testPreparedTimeout() {
  var pool = mysql.createPool(config());
  try {
    var poisoned = await firstConnection(pool);
    await assert.rejects(
      pool.execute('SELECT SLEEP(?) AS slept', [2], { timeout: 50 }),
      function (error) {
        assert.ok(error instanceof mysql.MySqlClientError);
        assert.strictEqual(error.code, mysql.ERROR_CODES.TIMEOUT);
        assert.strictEqual(error.category, 'timeout');
        return true;
      }
    );
    await assertReplacement(pool, poisoned);
  } finally {
    await pool.end();
  }
}

async function main() {
  var mode = process.argv[2] || 'all';
  if (mode === 'timeout' || mode === 'all') await testQueryTimeout();
  if (mode === 'abort' || mode === 'all') await testQueryAbort();
  if (mode === 'prepared' || mode === 'all') await testPreparedTimeout();
  console.log('ok - clean-room failure-path safety (' + mode + ')');
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exit(1);
});
