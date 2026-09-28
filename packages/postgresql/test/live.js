'use strict';

var assert = require('assert');
var postgres = require('..');

async function main() {
  var connection = postgres.createConnection({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'postgres',
    ssl: false,
    connectTimeout: 10000
  });

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

  await connection.query('CREATE TEMP TABLE nublox_rc_test(id int primary key, name text)');
  var insert = await connection.query("INSERT INTO nublox_rc_test(id, name) VALUES (1, 'alpha'), (2, 'beta')");
  assert.strictEqual(insert.rowCount, 2);
  var rows = await connection.query('SELECT id, name FROM nublox_rc_test ORDER BY id');
  assert.deepStrictEqual(rows.rows.map(function (row) { return [row.id, row.name]; }), [[1, 'alpha'], [2, 'beta']]);

  await connection.end();
}

main().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
