'use strict';

var assert = require('assert');
var postgres = require('..');

var OPERATION_TIMEOUT_MS = 15000;
var PROCESS_TIMEOUT_MS = 60000;

function config() {
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

async function *rows() {
  yield '1,alpha\n';
  await new Promise(function (resolve) { setTimeout(resolve, 5); });
  yield Buffer.from('2,beta\n');
  yield new Uint8Array(Buffer.from('3,gamma\n'));
}

async function main() {
  var connection = postgres.createConnection(config());
  await connection.connect();
  await connection.query('CREATE TEMP TABLE nublox_copy_test(id integer primary key, name text not null)');

  var imported = await connection.copyFrom(
    'COPY nublox_copy_test (id, name) FROM STDIN WITH (FORMAT csv)',
    rows(),
    { timeout: OPERATION_TIMEOUT_MS }
  );
  assert.strictEqual(imported.direction, 'from');
  assert.strictEqual(imported.format, 'text');
  assert.strictEqual(imported.rowCount, 3);
  assert.strictEqual(imported.command, 'COPY 3');
  assert.ok(imported.bytes > 0);

  var stored = await connection.query('SELECT id, name FROM nublox_copy_test ORDER BY id');
  assert.deepStrictEqual(stored.rows.map(function (row) { return [row.id, row.name]; }), [[1, 'alpha'], [2, 'beta'], [3, 'gamma']]);

  var exported = await connection.copyTo(
    'COPY (SELECT id, name FROM nublox_copy_test ORDER BY id) TO STDOUT WITH (FORMAT csv, HEADER true)',
    { timeout: OPERATION_TIMEOUT_MS }
  );
  assert.strictEqual(exported.direction, 'to');
  assert.strictEqual(exported.format, 'text');
  assert.strictEqual(exported.rowCount, 3);
  assert.strictEqual(exported.command, 'COPY 3');
  assert.strictEqual(exported.data.toString('utf8'), 'id,name\n1,alpha\n2,beta\n3,gamma\n');
  assert.strictEqual(exported.bytes, exported.data.length);

  var sinkChunks = [];
  var streamed = await connection.copyTo(
    'COPY (SELECT name FROM nublox_copy_test ORDER BY id) TO STDOUT',
    { timeout: OPERATION_TIMEOUT_MS, sink: async function (chunk) { sinkChunks.push(Buffer.from(chunk)); } }
  );
  assert.strictEqual(streamed.data, undefined);
  assert.strictEqual(Buffer.concat(sinkChunks).toString('utf8'), 'alpha\nbeta\ngamma\n');

  await assert.rejects(
    connection.copyFrom('COPY nublox_copy_test (id, name) FROM STDIN WITH (FORMAT csv)', '4,delta\n', { maxBytes: 2, timeout: OPERATION_TIMEOUT_MS }),
    /maxBytes/
  );
  var afterInputFailure = await connection.query('SELECT count(*)::int4 AS count FROM nublox_copy_test');
  assert.strictEqual(afterInputFailure.rows[0].count, 3);

  await assert.rejects(
    connection.copyTo('COPY (SELECT repeat(\'x\', 100)) TO STDOUT', { maxBytes: 10, timeout: OPERATION_TIMEOUT_MS }),
    /maxBytes/
  );
  var afterOutputFailure = await connection.query('SELECT 1::int4 AS ok');
  assert.strictEqual(afterOutputFailure.rows[0].ok, 1);

  await connection.end();

  var pool = postgres.createPool(Object.assign({}, config(), { connectionLimit: 2 }));
  var poolImport = await pool.copyFrom(
    'COPY (SELECT 1) TO STDOUT',
    'unused',
    { timeout: OPERATION_TIMEOUT_MS }
  ).then(function () { throw new Error('copyFrom accepted COPY TO STDOUT'); }, function (error) { return error; });
  assert.match(poolImport.message, /COPY TO STDOUT|COPY FROM STDIN|copyFrom/i);

  var poolExport = await pool.copyTo('COPY (SELECT 42::int4) TO STDOUT', { timeout: OPERATION_TIMEOUT_MS });
  assert.strictEqual(poolExport.data.toString('utf8'), '42\n');
  assert.strictEqual(pool.borrowedCount, 0);
  await pool.end();

  console.log('ok - PostgreSQL live COPY qualification');
}

var watchdog = setTimeout(function () {
  console.error('PostgreSQL live COPY qualification exceeded ' + PROCESS_TIMEOUT_MS + 'ms');
  process.exit(1);
}, PROCESS_TIMEOUT_MS);
if (typeof watchdog.unref === 'function') watchdog.unref();

main().then(function () {
  clearTimeout(watchdog);
}, function (error) {
  clearTimeout(watchdog);
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
