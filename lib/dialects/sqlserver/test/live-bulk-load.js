'use strict';

var assert = require('assert');
var fs = require('fs');
var nublox = require('../../../..');

function config() {
  var password = process.env.MSSQL_SA_PASSWORD;
  if (!password) throw new Error('MSSQL_SA_PASSWORD is required');
  var tdsVersion = process.env.MSSQL_TDS_VERSION || '8.0';
  var out = {
    dialect: 'sqlserver',
    pool: false,
    tdsVersion: tdsVersion,
    host: process.env.MSSQL_HOST || '127.0.0.1',
    port: Number(process.env.MSSQL_PORT || 1433),
    user: 'sa',
    password: password,
    database: 'master',
    connectTimeout: 10000,
    queryTimeout: 15000
  };
  if (tdsVersion === '7.4') {
    out.rejectUnauthorized = false;
  } else {
    var caPath = process.env.MSSQL_CA_PATH;
    if (!caPath) throw new Error('MSSQL_CA_PATH is required for TDS 8 qualification');
    out.serverName = process.env.MSSQL_SERVER_NAME || out.host;
    out.ca = fs.readFileSync(caPath);
    out.rejectUnauthorized = true;
  }
  return out;
}

function source(rows) {
  return {
    dialect: 'sqlite',
    compile: function (statement) { return { text: String(statement), parameters: [] }; },
    stream: function () {
      return (async function* () {
        for (var i = 0; i < rows.length; i += 1) yield rows[i];
      })();
    }
  };
}

async function main() {
  var db = nublox.createClient(config());
  try {
    await db.execute("IF OBJECT_ID('dbo.nublox_bulk_test','U') IS NOT NULL DROP TABLE dbo.nublox_bulk_test");
    await db.execute("IF OBJECT_ID('dbo.nublox_move_test','U') IS NOT NULL DROP TABLE dbo.nublox_move_test");
    await db.execute('CREATE TABLE dbo.nublox_bulk_test (id int NOT NULL, name nvarchar(4000) NULL, active bit NULL, score float NULL, payload varbinary(8000) NULL)');
    await db.execute('CREATE TABLE dbo.nublox_move_test (id int NOT NULL, name nvarchar(4000) NULL, active bit NULL)');

    var nativeResult = await db.native.bulkInsert(
      ['dbo', 'nublox_bulk_test'],
      ['id', 'name', 'active', 'score', 'payload'],
      [
        { id: 1, name: 'Ada', active: true, score: 1.5, payload: Buffer.from([1, 2]) },
        { id: 2, name: 'Grace', active: false, score: 2.75, payload: null },
        { id: 3, name: null, active: true, score: 3, payload: Buffer.from([0xaa]) }
      ],
      { timeout: 10000 }
    );

    assert.strictEqual(nativeResult.affectedRows, 3n);
    var nativeRows = await db.all('SELECT id, name, active, score, payload FROM dbo.nublox_bulk_test ORDER BY id');
    assert.strictEqual(nativeRows.length, 3);
    assert.strictEqual(nativeRows[0].name, 'Ada');
    assert.strictEqual(nativeRows[0].active, true);
    assert.strictEqual(nativeRows[1].payload, null);
    assert.deepStrictEqual(nativeRows[2].payload, Buffer.from([0xaa]));

    var moveSpec = {
      source: { statement: 'SELECT id, name, active FROM source ORDER BY id' },
      target: { table: ['dbo', 'nublox_move_test'], columns: ['id', 'name', 'active'] }
    };
    var transferPlan = nublox.planDataMovement(source([]), db, moveSpec);
    assert.strictEqual(transferPlan.strategy, 'sqlserver-tds-bulk');
    assert.strictEqual(transferPlan.accelerated, true);

    var moved = await nublox.moveData(source([
      { id: 11, name: 'one', active: true },
      { id: 12, name: 'two', active: false },
      { id: 13, name: null, active: true }
    ]), db, moveSpec, { batchSize: 2, strategy: 'native' });

    assert.strictEqual(moved.status, 'succeeded');
    assert.strictEqual(moved.rowsWritten, 3);
    assert.deepStrictEqual(moved.strategiesUsed, ['sqlserver-tds-bulk']);

    var movedRows = await db.all('SELECT id, name, active FROM dbo.nublox_move_test ORDER BY id');
    assert.deepStrictEqual(movedRows, [
      { id: 11, name: 'one', active: true },
      { id: 12, name: 'two', active: false },
      { id: 13, name: null, active: true }
    ]);

    var fallback = await nublox.moveData(source([{ id: 21, name: { unsupported: true }, active: true }]), db, moveSpec, { strategy: 'auto' });
    assert.strictEqual(fallback.status, 'failed');
    assert.match(fallback.error.message, /Unsupported SQL Server RPC parameter type|cannot encode|parameter type/);

    console.log('NuBloxSQL live SQL Server native TDS bulk-load qualification passed for TDS ' + (process.env.MSSQL_TDS_VERSION || '8.0'));
  } finally {
    try { await db.execute("IF OBJECT_ID('dbo.nublox_bulk_test','U') IS NOT NULL DROP TABLE dbo.nublox_bulk_test"); } catch (_) {}
    try { await db.execute("IF OBJECT_ID('dbo.nublox_move_test','U') IS NOT NULL DROP TABLE dbo.nublox_move_test"); } catch (_) {}
    await db.close();
  }
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
