'use strict';

var assert = require('assert');
var mysql = require('..');

function userConfig(extra) {
  return Object.assign({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'nublox',
    password: process.env.MYSQL_PASSWORD || 'nublox_ci_password',
    database: process.env.MYSQL_DATABASE || 'nublox_ci',
    ssl: false,
    localInfile: true
  }, extra || {});
}

function rootConfig() {
  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: 'root',
    password: process.env.MYSQL_ROOT_PASSWORD || 'nublox_root_password',
    database: process.env.MYSQL_DATABASE || 'nublox_ci',
    ssl: false
  };
}

async function *rows() {
  yield '1,alpha\n';
  yield Buffer.from('2,beta\n');
  yield new Uint8Array(Buffer.from('3,gamma\n'));
}

async function enableServerLocalInfile() {
  var root = mysql.createConnection(rootConfig());
  try {
    await root.connect();
    await root.query('SET GLOBAL local_infile = ON');
  } finally {
    await root.end();
  }
}

async function main() {
  await enableServerLocalInfile();

  var connection = mysql.createConnection(userConfig());
  await connection.connect();
  await connection.query('DROP TABLE IF EXISTS nublox_local_infile');
  await connection.query('CREATE TABLE nublox_local_infile (id INT PRIMARY KEY, name VARCHAR(100) NOT NULL)');

  var sql = "LOAD DATA LOCAL INFILE 'nublox-inline.csv' INTO TABLE nublox_local_infile FIELDS TERMINATED BY ',' LINES TERMINATED BY '\\n' (id, name)";
  var result = await connection.loadDataLocal(sql, rows(), { filename: 'nublox-inline.csv', maxBytes: 1024, timeout: 15000 });
  assert.strictEqual(Number(result.affectedRows), 3);
  assert.strictEqual(result.localInfile.filename, 'nublox-inline.csv');
  assert.strictEqual(result.localInfile.bytes, Buffer.byteLength('1,alpha\n2,beta\n3,gamma\n'));

  var selected = await connection.query('SELECT id, name FROM nublox_local_infile ORDER BY id');
  assert.deepStrictEqual(selected.rows.map(function (row) { return [Number(row.id), row.name]; }), [[1, 'alpha'], [2, 'beta'], [3, 'gamma']]);
  await connection.end();

  var pool = mysql.createPool(Object.assign(userConfig(), { connectionLimit: 2 }));
  await pool.query('TRUNCATE TABLE nublox_local_infile');
  var pooled = await pool.loadDataLocal(sql, '4,delta\n5,epsilon\n', { filename: 'nublox-inline.csv', maxBytes: 1024, timeout: 15000 });
  assert.strictEqual(Number(pooled.affectedRows), 2);
  assert.strictEqual(pool.totalCount >= 1, true);
  await pool.end();

  var mismatch = mysql.createConnection(userConfig());
  await mismatch.connect();
  await assert.rejects(
    mismatch.loadDataLocal(sql, '6,zeta\n', { filename: 'unexpected.csv', timeout: 15000 }),
    /unexpected filename/
  );
  assert.strictEqual(mismatch.ended, true);

  var rejected = mysql.createConnection(userConfig());
  await rejected.connect();
  await assert.rejects(rejected.query(sql, { timeout: 15000 }), /use loadDataLocal/);
  assert.strictEqual(rejected.ended, true);

  var limited = mysql.createConnection(userConfig());
  await limited.connect();
  await assert.rejects(
    limited.loadDataLocal(sql, '7,too-large\n', { filename: 'nublox-inline.csv', maxBytes: 4, timeout: 15000 }),
    /maxBytes/
  );
  assert.strictEqual(limited.ended, true);

  var cleanup = mysql.createConnection(userConfig({ localInfile: false }));
  try {
    await cleanup.connect();
    await cleanup.query('DROP TABLE IF EXISTS nublox_local_infile');
  } finally {
    await cleanup.end();
  }

  console.log('ok - MySQL live LOCAL INFILE qualification');
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
