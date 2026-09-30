'use strict';

var assert = require('assert');
var fs = require('fs');
var nubloxsql = require('../../../..');

var LONG_SQL_COMMENT = 'x'.repeat(30000);
var UNICODE_MAX = 'NuBlox input Ω 🚀 '.repeat(700);
var BINARY_MAX = Buffer.alloc(12000, 0x5a);

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
    pool: { max: 1 }
  });

  try {
    var batch = await db.one('SELECT 1 AS value /*' + LONG_SQL_COMMENT + '*/');
    assert.strictEqual(batch.value, 1);
    console.log('NuBloxSQL SQL Server large multi-packet SQL_BATCH passed');

    var unicode = await db.one(nubloxsql.sql`SELECT ${UNICODE_MAX} AS unicode_input`);
    assert.strictEqual(unicode.unicode_input, UNICODE_MAX);
    console.log('NuBloxSQL SQL Server NVARCHAR(MAX) RPC input passed');

    var binary = await db.one(nubloxsql.sql`SELECT ${BINARY_MAX} AS binary_input`);
    assert.deepStrictEqual(binary.binary_input, BINARY_MAX);
    console.log('NuBloxSQL SQL Server VARBINARY(MAX) RPC input passed');
  } finally {
    await db.close();
  }
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
