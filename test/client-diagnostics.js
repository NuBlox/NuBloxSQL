'use strict';

var assert = require('assert');
var sql = require('..');

async function main() {
  assert.strictEqual(sql.QUERY_DIAGNOSTICS_SCHEMA_VERSION, 1);

  var mysqlSeen = null;
  var mysqlNative = Object.freeze({
    format: 'json',
    analyzed: false,
    statementExecuted: false,
    plan: Object.freeze({ query_block: Object.freeze({}) }),
    root: Object.freeze({}),
    summary: Object.freeze({
      nodeCount: 3,
      maxDepth: 2,
      tables: Object.freeze(['users']),
      accessTypes: Object.freeze(['ref']),
      operations: Object.freeze([]),
      queryType: null,
      jsonSchemaVersion: null,
      estimatedRows: 12,
      estimatedTotalCost: 4.5,
      actualRows: null,
      actualLoops: null,
      actualFirstRowMs: null,
      actualLastRowMs: null
    })
  });
  var mysqlTarget = {
    connected: true,
    ended: false,
    diagnoseQuery: async function diagnoseQuery(text, parameters, options) {
      mysqlSeen = { text: text, parameters: parameters, options: options };
      return mysqlNative;
    }
  };
  var mysql = new sql.Client(sql.adapter('mysql'), 'mysql', {}, mysqlTarget, false);
  var mysqlReport = await mysql.diagnose(sql.sql`SELECT * FROM users WHERE id = ${42}`, { timeout: 5000 });
  assert.strictEqual(mysqlSeen.text, 'SELECT * FROM users WHERE id = ?');
  assert.deepStrictEqual(mysqlSeen.parameters, [42]);
  assert.strictEqual(mysqlSeen.options.timeout, 5000);
  assert.strictEqual(mysqlReport.schemaVersion, 1);
  assert.strictEqual(mysqlReport.dialect, 'mysql');
  assert.strictEqual(mysqlReport.mode, 'plan');
  assert.strictEqual(mysqlReport.analyzed, false);
  assert.strictEqual(mysqlReport.statementExecuted, false);
  assert.deepStrictEqual(mysqlReport.statement, { text: 'SELECT * FROM users WHERE id = ?', parameterCount: 1 });
  assert.deepStrictEqual(mysqlReport.summary, {
    nodeCount: 3,
    maxDepth: 2,
    estimatedRows: 12,
    actualRows: null,
    estimatedCost: 4.5,
    planningTimeMs: null,
    executionTimeMs: null
  });
  assert.strictEqual(mysqlReport.native, mysqlNative);
  assert.strictEqual(Object.isFrozen(mysqlReport), true);

  var pgSeen = null;
  var pgNative = Object.freeze({
    format: 'json',
    analyzed: true,
    statementExecuted: true,
    plan: Object.freeze([]),
    root: Object.freeze({}),
    summary: Object.freeze({
      rootNodeType: 'Index Scan',
      totalCost: 8.75,
      planRows: 5,
      actualRows: 4,
      actualTotalTime: 0.8,
      planningTime: 0.2,
      executionTime: 1.1,
      nodeCount: 2,
      maxDepth: 1,
      nodeTypes: Object.freeze({ 'Index Scan': 1, 'Index Only Scan': 1 })
    }),
    settings: null,
    triggers: null,
    jit: null
  });
  var pgTarget = {
    connected: true,
    ended: false,
    explainAnalyze: async function explainAnalyze(text, parameters, options) {
      pgSeen = { text: text, parameters: parameters, options: options };
      return pgNative;
    }
  };
  var pg = new sql.Client(sql.adapter('postgresql'), 'postgresql', {}, pgTarget, false);
  var pgReport = await pg.diagnose(sql.sql`SELECT * FROM users WHERE id = ${7}`, { analyze: true, buffers: true });
  assert.strictEqual(pgSeen.text, 'SELECT * FROM users WHERE id = $1');
  assert.deepStrictEqual(pgSeen.parameters, [7]);
  assert.strictEqual(pgSeen.options.analyze, true);
  assert.strictEqual(pgSeen.options.buffers, true);
  assert.strictEqual(pgReport.mode, 'analyze');
  assert.strictEqual(pgReport.analyzed, true);
  assert.strictEqual(pgReport.statementExecuted, true);
  assert.deepStrictEqual(pgReport.summary, {
    nodeCount: 2,
    maxDepth: 1,
    estimatedRows: 5,
    actualRows: 4,
    estimatedCost: 8.75,
    planningTimeMs: 0.2,
    executionTimeMs: 1.1
  });
  assert.strictEqual(pgReport.native, pgNative);

  var sqlite = sql.createClient({ dialect: 'sqlite', filename: ':memory:', pool: false });
  try {
    assert.strictEqual(sql.supports('sqlite', 'queryDiagnostics'), true);
    assert.strictEqual(sqlite.supports('queryDiagnostics'), true);
    await sqlite.execute(sql.sql`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL)`);
    await sqlite.execute(sql.sql`CREATE INDEX idx_users_email ON users(email)`);
    await sqlite.execute(sql.sql`INSERT INTO users (id, email) VALUES (${1}, ${'one@example.com'})`);

    var sqliteReport = await sqlite.diagnose(
      sql.sql`SELECT id FROM users WHERE email = ${'one@example.com'}`,
      { includeOpcodes: true }
    );
    assert.strictEqual(sqliteReport.schemaVersion, 1);
    assert.strictEqual(sqliteReport.dialect, 'sqlite');
    assert.strictEqual(sqliteReport.mode, 'plan');
    assert.strictEqual(sqliteReport.analyzed, false);
    assert.strictEqual(sqliteReport.statementExecuted, false);
    assert.strictEqual(sqliteReport.statement.parameterCount, 1);
    assert.ok(sqliteReport.summary.nodeCount >= 1);
    assert.strictEqual(sqliteReport.summary.estimatedRows, null);
    assert.ok(sqliteReport.native.plan);
    assert.ok(sqliteReport.native.explain);
    assert.ok(Array.isArray(sqliteReport.native.explain.opcodes));
    assert.strictEqual(Object.isFrozen(sqliteReport.warnings), true);

    await assert.rejects(
      function () { return sqlite.diagnose('SELECT 1', { analyze: true }); },
      function (error) {
        assert.ok(error instanceof sql.NuBloxSqlError);
        assert.strictEqual(error.category, 'unsupported');
        assert.strictEqual(error.dialect, 'sqlite');
        return true;
      }
    );
  } finally {
    await sqlite.close();
  }

  var sqlServerTarget = { connected: true, ended: false };
  var sqlServer = new sql.Client(sql.adapter('sqlserver'), 'sqlserver', {}, sqlServerTarget, false);
  await assert.rejects(
    function () { return sqlServer.diagnose('SELECT 1'); },
    function (error) {
      assert.ok(error instanceof sql.NuBloxSqlError);
      assert.strictEqual(error.category, 'unsupported');
      assert.strictEqual(error.dialect, 'sqlserver');
      return true;
    }
  );

  await assert.rejects(
    function () { return mysql.diagnose('SELECT 1', { analyze: 'yes' }); },
    /analyze must be a boolean/
  );

  console.log('NuBloxSQL portable query diagnostics contract passed');
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
