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
    ssl: 'disable',
    connectTimeout: 5000
  }, overrides || {});
}

async function badPasswordIsRejected() {
  var connection = postgresql.createConnection(config({ password: 'definitely-wrong-password' }));
  await assert.rejects(connection.connect(), function (error) {
    return error && (error.code === '28P01' || /password authentication failed/i.test(error.message));
  });
  connection.destroy();
}

async function tlsRequireRefusalIsRejected() {
  var connection = postgresql.createConnection(config({ ssl: 'require' }));
  await assert.rejects(connection.connect(), /refused TLS|SSL|TLS/i);
  connection.destroy();
}

async function preAbortedConnectionIsRejected() {
  var controller = new AbortController();
  controller.abort(new Error('pre-aborted PostgreSQL connection'));
  var connection = postgresql.createConnection(config({ signal: controller.signal }));
  await assert.rejects(connection.connect(), /pre-aborted PostgreSQL connection|aborted/i);
  connection.destroy();
}

async function healthyConnectionStillWorksAfterFailures() {
  var connection = postgresql.createConnection(config());
  await connection.connect();
  var result = await connection.query('SELECT current_setting(\'server_version_num\')::int4 AS version_num, 1::int4 AS ok');
  assert.strictEqual(result.rows[0].ok, 1);
  assert.ok(Number(result.rows[0].version_num) >= 150000);
  await connection.end();
}

Promise.resolve()
  .then(badPasswordIsRejected)
  .then(tlsRequireRefusalIsRejected)
  .then(preAbortedConnectionIsRejected)
  .then(healthyConnectionStillWorksAfterFailures)
  .then(function () { console.log('ok - live PostgreSQL TLS/auth failure paths'); })
  .catch(function (error) {
    console.error(error.stack || error);
    process.exit(1);
  });
