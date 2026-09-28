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

  var rows = await connection.query('SELECT id, name, active FROM nublox_rc_test ORDER BY id');
  assert.deepStrictEqual(rows.rows.map(function (row) { return [row.id, row.name, row.active]; }), [[1, 'alpha', true], [2, 'beta', false]]);

  await connection.end();
}

main().catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
