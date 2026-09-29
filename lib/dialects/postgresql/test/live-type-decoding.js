'use strict';

var assert = require('assert');
var postgresql = require('..');

function config() {
  return {
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'nublox',
    password: process.env.PGPASSWORD || 'nublox_ci_password',
    database: process.env.PGDATABASE || 'nublox',
    ssl: 'disable'
  };
}

async function run() {
  var connection = postgresql.createConnection(config());
  await connection.connect();
  var result = await connection.query([
    'SELECT',
    '  9223372036854775807::int8 AS big_value,',
    '  12345678901234567890.123456789::numeric AS exact_numeric,',
    "  decode('0001ff', 'hex')::bytea AS bytes_value,",
    "  '2026-09-28 12:34:56+00'::timestamptz AS absolute_time,",
    "  '2026-09-28 12:34:56'::timestamp AS local_time,",
    "  '2026-09-28'::date AS date_value,",
    "  '{\"ok\":true}'::jsonb AS json_value"
  ].join('\n'));

  var row = result.rows[0];
  assert.strictEqual(row.big_value, 9223372036854775807n);
  assert.strictEqual(row.exact_numeric, '12345678901234567890.123456789');
  assert.ok(Buffer.isBuffer(row.bytes_value));
  assert.deepStrictEqual(Array.from(row.bytes_value), [0, 1, 255]);
  assert.ok(row.absolute_time instanceof Date);
  assert.strictEqual(row.absolute_time.toISOString(), '2026-09-28T12:34:56.000Z');
  assert.strictEqual(row.local_time, '2026-09-28 12:34:56');
  assert.strictEqual(row.date_value, '2026-09-28');
  assert.deepStrictEqual(row.json_value, { ok: true });

  await connection.end();
  console.log('ok - live PostgreSQL deterministic type policy');
}

run().catch(function (error) {
  console.error(error.stack || error);
  process.exit(1);
});
