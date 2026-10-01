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
    ssl: false
  };
}

async function main() {
  var connection = mysql.createConnection(config());
  await connection.connect();
  try {
    await connection.query('DROP TABLE IF EXISTS nublox_explain_diag');
    await connection.query('CREATE TABLE nublox_explain_diag (id INT PRIMARY KEY, category VARCHAR(20) NOT NULL, amount INT NOT NULL, KEY idx_category (category))');
    await connection.query("INSERT INTO nublox_explain_diag VALUES (1,'a',10),(2,'a',20),(3,'b',30),(4,'c',40)");

    var before = await connection.query('SELECT @@SESSION.explain_json_format_version AS v');
    var beforeVersion = Number(before.rows[0].v);

    var planned = await connection.explain('SELECT amount FROM nublox_explain_diag WHERE category = ?', ['a']);
    assert.strictEqual(planned.format, 'json');
    assert.strictEqual(planned.analyzed, false);
    assert.strictEqual(planned.statementExecuted, false);
    assert.strictEqual(planned.summary.tables.indexOf('nublox_explain_diag') !== -1, true);
    assert.strictEqual(planned.summary.accessTypes.length > 0, true);
    assert.strictEqual(Object.isFrozen(planned.plan), true);

    var analyzed = await connection.explainAnalyze('SELECT SUM(amount) AS total FROM nublox_explain_diag WHERE amount >= ?', [20]);
    assert.strictEqual(analyzed.format, 'json');
    assert.strictEqual(analyzed.analyzed, true);
    assert.strictEqual(analyzed.statementExecuted, true);
    assert.strictEqual(analyzed.jsonFormatVersion, 2);
    assert.strictEqual(analyzed.summary.jsonSchemaVersion, '2.0');
    assert.strictEqual(analyzed.summary.nodeCount > 0, true);
    assert.strictEqual(analyzed.summary.actualRows !== null || analyzed.summary.operations.length > 0, true);

    var after = await connection.query('SELECT @@SESSION.explain_json_format_version AS v');
    assert.strictEqual(Number(after.rows[0].v), beforeVersion);

    await assert.rejects(
      connection.explainAnalyze('UPDATE nublox_explain_diag SET amount = amount + 1 WHERE id = 1'),
      /allowMutation/
    );
    var unchanged = await connection.query('SELECT amount FROM nublox_explain_diag WHERE id = 1');
    assert.strictEqual(Number(unchanged.rows[0].amount), 10);

    var pool = mysql.createPool(Object.assign(config(), { connectionLimit: 2 }));
    try {
      var pooled = await pool.explain('SELECT * FROM nublox_explain_diag WHERE id = 1');
      assert.strictEqual(pooled.analyzed, false);
      var pooledAnalyzed = await pool.explainAnalyze('SELECT * FROM nublox_explain_diag WHERE id > 1');
      assert.strictEqual(pooledAnalyzed.analyzed, true);
      assert.strictEqual(pool.totalCount >= 1, true);
    } finally {
      await pool.end();
    }

    await connection.query('DROP TABLE nublox_explain_diag');
    console.log('ok - MySQL ' + (connection.server && connection.server.serverVersion ? connection.server.serverVersion : 'server') + ' structured EXPLAIN diagnostics');
  } finally {
    if (connection.connected && !connection.ended) await connection.end();
  }
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
