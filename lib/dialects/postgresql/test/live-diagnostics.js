'use strict';

var assert = require('assert');
var postgres = require('..');

function config() {
  return {
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'nublox',
    password: process.env.PGPASSWORD || 'nublox_ci_password',
    database: process.env.PGDATABASE || 'nublox',
    ssl: false
  };
}

(async function () {
  var expectedMajor = Number(process.env.PG_EXPECTED_MAJOR || 0);
  var db = postgres.createConnection(config());
  await db.connect();
  try {
    assert.strictEqual(postgres.capabilities.queryDiagnostics, true);
    assert.ok(db.parameters.server_version);

    await db.query('DROP TABLE IF EXISTS nublox_explain_diag');
    await db.query('CREATE TABLE nublox_explain_diag (id integer PRIMARY KEY, payload text NOT NULL)');
    await db.query("INSERT INTO nublox_explain_diag SELECT g, repeat('x', 32) FROM generate_series(1, 200) g");
    await db.query('ANALYZE nublox_explain_diag');

    var plan = await db.explain('SELECT payload FROM nublox_explain_diag WHERE id = $1', [42], { settings: true });
    assert.strictEqual(plan.format, 'json');
    assert.strictEqual(plan.analyzed, false);
    assert.strictEqual(plan.statementExecuted, false);
    assert.ok(plan.root && typeof plan.root['Node Type'] === 'string');
    assert.ok(plan.summary.nodeCount >= 1);
    assert.ok(plan.summary.totalCost !== null);
    assert.ok(Object.isFrozen(plan));

    var analyzed = await db.explainAnalyze('SELECT sum(id) FROM nublox_explain_diag', [], {
      buffers: true,
      wal: true,
      timing: false,
      summary: true
    });
    assert.strictEqual(analyzed.analyzed, true);
    assert.strictEqual(analyzed.statementExecuted, true);
    assert.ok(analyzed.summary.executionTime !== null);
    assert.ok(analyzed.summary.actualRows !== null);

    var alias = await db.diagnoseQuery('SELECT count(*) FROM nublox_explain_diag');
    assert.strictEqual(alias.analyzed, false);

    if (expectedMajor >= 16) {
      var generic = await db.explain('SELECT payload FROM nublox_explain_diag WHERE id = $1::integer', [], { genericPlan: true });
      assert.strictEqual(generic.analyzed, false);
    } else {
      await assert.rejects(function () {
        return db.explain('SELECT payload FROM nublox_explain_diag WHERE id = $1::integer', [], { genericPlan: true });
      }, /PostgreSQL 16/);
    }

    if (expectedMajor >= 17) {
      var serialized = await db.explainAnalyze('SELECT payload FROM nublox_explain_diag WHERE id <= 5', [], { serialize: 'text', timing: false });
      assert.strictEqual(serialized.analyzed, true);
    } else {
      await assert.rejects(function () {
        return db.explainAnalyze('SELECT 1', [], { serialize: 'text' });
      }, /PostgreSQL 17/);
    }

    if (expectedMajor >= 18) {
      var memory = await db.explain('SELECT 1', [], { memory: true });
      assert.strictEqual(memory.analyzed, false);
    } else {
      await assert.rejects(function () { return db.explain('SELECT 1', [], { memory: true }); }, /PostgreSQL 18/);
    }

    var pool = postgres.createPool(Object.assign(config(), { connectionLimit: 2 }));
    try {
      var pooled = await pool.explain('SELECT 1');
      assert.strictEqual(pooled.summary.rootNodeType, 'Result');
      assert.strictEqual(pool.borrowedCount, 0);
      var pooledAnalyzed = await pool.explainAnalyze('SELECT 1');
      assert.strictEqual(pooledAnalyzed.analyzed, true);
      assert.strictEqual(pool.borrowedCount, 0);
    } finally {
      await pool.end();
    }

    await db.query('DROP TABLE nublox_explain_diag');
    console.log('ok - PostgreSQL ' + db.parameters.server_version + ' structured EXPLAIN diagnostics');
  } finally {
    await db.end();
  }
})().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
