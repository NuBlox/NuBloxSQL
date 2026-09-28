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

function timeout(ms, label, cleanup) {
  return new Promise(function (_, reject) {
    var timer = setTimeout(function () {
      try { if (cleanup) cleanup(); } catch (_) {}
      reject(new Error(label + ' timed out after ' + ms + 'ms'));
    }, ms);
    if (timer.unref) timer.unref();
  });
}

async function collect(stream) {
  var rows = [];
  for await (var row of stream) rows.push(row);
  return rows;
}

async function direct() {
  var connection = mysql.createConnection(config());
  try {
    await connection.connect();
    var stream = connection.queryStream('SELECT 1 AS n UNION ALL SELECT 2 AS n ORDER BY n', { highWaterMark: 1 });
    var rows = await Promise.race([
      collect(stream),
      timeout(5000, 'direct streaming', function () { connection.destroy(); })
    ]);
    assert.deepStrictEqual(rows.map(function (row) { return row.n; }), ['1', '2']);
    assert.strictEqual(stream.rowCount, 2);
  } finally {
    if (!connection.ended) await connection.end();
  }
}

async function pooled() {
  var pool = mysql.createPool(Object.assign(config(), {
    connectionLimit: 1,
    maxIdle: 1,
    idleTimeout: 30000,
    acquireTimeout: 5000
  }));
  try {
    var stream = await pool.queryStream('SELECT 11 AS n UNION ALL SELECT 12 AS n ORDER BY n', { highWaterMark: 1 });
    var rows = await Promise.race([
      collect(stream),
      timeout(5000, 'pooled streaming', function () { stream.destroy(); })
    ]);
    assert.deepStrictEqual(rows.map(function (row) { return row.n; }), ['11', '12']);
    var followUp = await Promise.race([
      pool.query('SELECT 13 AS n'),
      timeout(5000, 'pooled streaming follow-up', function () { pool.end(); })
    ]);
    assert.strictEqual(followUp.rows[0].n, '13');
  } finally {
    await pool.end();
  }
}

async function limits() {
  var connection = mysql.createConnection(config());
  await connection.connect();
  var stream = connection.queryStream('SELECT 21 AS n UNION ALL SELECT 22 AS n', { maxRows: 1 });
  try {
    await Promise.race([
      assert.rejects(async function () { await collect(stream); }, function (error) {
        return error instanceof mysql.MySqlResultLimitError && error.code === 'NUBLOX_MYSQL_MAX_ROWS';
      }),
      timeout(5000, 'streaming maxRows breach', function () { connection.destroy(); })
    ]);
    assert.strictEqual(connection.ended, true);
  } finally {
    if (!connection.ended) connection.destroy();
  }
}

async function main() {
  var target = process.argv[2];
  if (target === 'direct') await direct();
  else if (target === 'pool') await pooled();
  else if (target === 'limits') await limits();
  else throw new Error('Expected live streaming target: direct, pool, or limits');
  process.stdout.write('clean-room live streaming ' + target + ' passed\n');
}

main().catch(function (error) {
  process.stderr.write((error && error.stack) ? error.stack + '\n' : String(error) + '\n');
  process.exit(1);
});
