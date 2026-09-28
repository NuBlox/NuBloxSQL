'use strict';

var assert = require('assert');
var postgresql = require('..');

function config(overrides) {
  return Object.assign({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'nublox',
    password: process.env.PGPASSWORD || 'nublox_ci_password',
    database: process.env.PGDATABASE || 'nublox',
    ssl: 'disable'
  }, overrides || {});
}

async function rowLimitDestroysConnection() {
  var connection = postgresql.createConnection(config({ maxRows: 2 }));
  await connection.connect();
  await assert.rejects(connection.query('SELECT generate_series(1, 3) AS id'), function (error) {
    return error instanceof postgresql.PostgreSqlResultLimitError && error.code === 'NUBLOX_POSTGRESQL_MAX_ROWS';
  });
  connection.destroy();
}

async function rowByteLimitDestroysConnection() {
  var connection = postgresql.createConnection(config({ maxRowBytes: 8 }));
  await connection.connect();
  await assert.rejects(connection.query("SELECT repeat('x', 32) AS payload"), function (error) {
    return error instanceof postgresql.PostgreSqlResultLimitError && error.code === 'NUBLOX_POSTGRESQL_MAX_ROW_BYTES';
  });
  connection.destroy();
}

async function poolReplacesLimitedConnection() {
  var pool = postgresql.createPool(config({ connectionLimit: 1, maxRows: 1 }));
  await assert.rejects(pool.query('SELECT generate_series(1, 2) AS id'), function (error) {
    return error instanceof postgresql.PostgreSqlResultLimitError && error.code === 'NUBLOX_POSTGRESQL_MAX_ROWS';
  });
  var result = await pool.query('SELECT 1::int4 AS ok', { maxRows: 2 });
  assert.strictEqual(result.rows[0].ok, 1);
  await pool.end();
}

Promise.resolve()
  .then(rowLimitDestroysConnection)
  .then(rowByteLimitDestroysConnection)
  .then(poolReplacesLimitedConnection)
  .then(function () { console.log('ok - live PostgreSQL result-limit safety'); })
  .catch(function (error) {
    console.error(error.stack || error);
    process.exit(1);
  });
