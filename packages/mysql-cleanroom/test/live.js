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

  await connection.query('CREATE TEMPORARY TABLE nublox_cleanroom_live (id BIGINT PRIMARY KEY, name VARCHAR(64) NOT NULL, score DOUBLE NULL)');
  var inserted = await connection.query("INSERT INTO nublox_cleanroom_live (id, name, score) VALUES (2, 'beta', 2.5), (1, 'alpha', NULL)");
  assert.strictEqual(Number(inserted.affectedRows), 2);

  var selected = await connection.query('SELECT id, name FROM nublox_cleanroom_live ORDER BY id');
  assert.deepStrictEqual(selected.rows.map(function (row) { return [row.id, row.name]; }), [['1', 'alpha'], ['2', 'beta']]);

  var selectStatement = await connection.prepare('SELECT ? AS n, ? AS label, ? AS nullable_value');
  assert.strictEqual(selectStatement.parameterCount, 3);
  assert.strictEqual(selectStatement.columnCount, 3);
  var preparedSelected = await selectStatement.execute([42, 'prepared', null]);
  assert.strictEqual(preparedSelected.rows.length, 1);
  assert.strictEqual(preparedSelected.rows[0].n, 42);
  assert.strictEqual(preparedSelected.rows[0].label, 'prepared');
  assert.strictEqual(preparedSelected.rows[0].nullable_value, null);
  await selectStatement.reset();
  var selectedAgain = await selectStatement.execute([84n, 'again', 'value']);
  assert.strictEqual(selectedAgain.rows[0].n, 84);
  assert.strictEqual(selectedAgain.rows[0].label, 'again');
  assert.strictEqual(selectedAgain.rows[0].nullable_value, 'value');
  await selectStatement.close();
  assert.strictEqual(selectStatement.closed, true);

  var insertStatement = await connection.prepare('INSERT INTO nublox_cleanroom_live (id, name, score) VALUES (?, ?, ?)');
  assert.strictEqual(insertStatement.parameterCount, 3);
  var preparedInsert = await insertStatement.execute([3, 'gamma', 3.75]);
  assert.strictEqual(Number(preparedInsert.affectedRows), 1);
  await insertStatement.close();

  var verifyStatement = await connection.prepare('SELECT id, name, score FROM nublox_cleanroom_live WHERE id = ?');
  var verified = await verifyStatement.execute([3]);
  assert.strictEqual(verified.rows.length, 1);
  assert.strictEqual(verified.rows[0].id, 3);
  assert.strictEqual(verified.rows[0].name, 'gamma');
  assert.strictEqual(verified.rows[0].score, 3.75);
  await verifyStatement.close();

  await connection.end();
  process.stdout.write('clean-room MySQL live connection/query/prepared smoke passed\n');
}

main().catch(function (error) {
  process.stderr.write((error && error.stack) ? error.stack + '\n' : String(error) + '\n');
  process.exitCode = 1;
});
