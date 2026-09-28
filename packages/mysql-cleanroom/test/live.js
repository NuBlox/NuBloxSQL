'use strict';

var assert = require('assert');
var mysql = require('..');

async function main() {
  var connection = mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'nublox',
    password: process.env.MYSQL_PASSWORD || 'nublox_ci_password',
    database: process.env.MYSQL_DATABASE || 'nublox_ci',
    ssl: 'disable',
    getServerPublicKey: true,
    connectTimeout: 15000
  });

  await connection.connect();
  assert.strictEqual(connection.connected, true);
  assert.ok(connection.server);
  assert.strictEqual(connection.server.authPluginName, 'caching_sha2_password');

  var first = await connection.query("SELECT 1 AS one, 'NuBlox' AS name");
  assert.strictEqual(first.rows.length, 1);
  assert.strictEqual(first.rows[0].one, '1');
  assert.strictEqual(first.rows[0].name, 'NuBlox');

  await connection.query('CREATE TEMPORARY TABLE nublox_cleanroom_live (id INT PRIMARY KEY, name VARCHAR(64) NOT NULL)');
  var inserted = await connection.query("INSERT INTO nublox_cleanroom_live (id, name) VALUES (2, 'beta'), (1, 'alpha')");
  assert.strictEqual(Number(inserted.affectedRows), 2);

  var selected = await connection.query('SELECT id, name FROM nublox_cleanroom_live ORDER BY id');
  assert.deepStrictEqual(selected.rows.map(function (row) { return [row.id, row.name]; }), [['1', 'alpha'], ['2', 'beta']]);

  await connection.end();
  process.stdout.write('clean-room MySQL live connection/query smoke passed\n');
}

main().catch(function (error) {
  process.stderr.write((error && error.stack) ? error.stack + '\n' : String(error) + '\n');
  process.exitCode = 1;
});
