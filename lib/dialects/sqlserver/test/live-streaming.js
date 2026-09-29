'use strict';

var assert = require('assert');
var fs = require('fs');
var nubloxsql = require('../../../..');
var sql = nubloxsql.sql;

async function main() {
  var password = process.env.MSSQL_SA_PASSWORD;
  var caPath = process.env.MSSQL_CA_PATH;
  if (!password) throw new Error('MSSQL_SA_PASSWORD is required');
  if (!caPath) throw new Error('MSSQL_CA_PATH is required');

  var db = nubloxsql.createClient({
    dialect: 'sqlserver',
    host: process.env.MSSQL_HOST || '127.0.0.1',
    port: Number(process.env.MSSQL_PORT || 1433),
    user: 'sa',
    password: password,
    database: 'master',
    serverName: process.env.MSSQL_SERVER_NAME || 'sqlserver',
    ca: fs.readFileSync(caPath),
    rejectUnauthorized: true,
    connectTimeout: 5000,
    queryTimeout: 15000,
    cancelTimeout: 5000,
    pool: { max: 1 }
  });

  try {
    var values = [];
    var stream = db.stream(sql`
      WITH numbers AS (
        SELECT 1 AS n
        UNION ALL
        SELECT n + 1 FROM numbers WHERE n < ${250}
      )
      SELECT n FROM numbers ORDER BY n OPTION (MAXRECURSION 0)
    `, { highWaterMark: 2 });
    for await (var row of stream) values.push(row.n);
    assert.strictEqual(values.length, 250);
    assert.strictEqual(values[0], 1);
    assert.strictEqual(values[249], 250);
    assert.ok(stream.fields && stream.fields.length === 1);

    var early = db.stream(sql`
      WITH numbers AS (
        SELECT 1 AS n
        UNION ALL
        SELECT n + 1 FROM numbers WHERE n < ${100000}
      )
      SELECT n FROM numbers ORDER BY n OPTION (MAXRECURSION 0)
    `, { highWaterMark: 1, cancelTimeout: 5000 });
    var seen = 0;
    for await (var item of early) {
      assert.strictEqual(item.n, seen + 1);
      seen += 1;
      if (seen === 5) break;
    }
    assert.strictEqual(seen, 5);

    var healthy = await db.one(sql`SELECT ${7} AS value`);
    assert.strictEqual(healthy.value, 7);
    assert.strictEqual(db.native.borrowedCount, 0);
    console.log('NuBloxSQL live SQL Server streaming and early-cancel reuse passed');
  } finally {
    await db.close();
  }
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
