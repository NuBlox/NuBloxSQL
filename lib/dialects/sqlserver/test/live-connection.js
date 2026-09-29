'use strict';

var assert = require('assert');
var sqlserver = require('..');

function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

async function connectWithRetry(config) {
  var lastError;
  for (var attempt = 1; attempt <= 45; attempt++) {
    var connection = sqlserver.createConnection(config);
    try {
      await connection.connect();
      return connection;
    } catch (error) {
      lastError = error;
      try { await connection.end(); } catch (_) {}
      if (attempt < 45) await sleep(2000);
    }
  }
  throw lastError;
}

async function main() {
  var password = process.env.MSSQL_SA_PASSWORD;
  if (!password) throw new Error('MSSQL_SA_PASSWORD is required');
  var connection = await connectWithRetry({
    host: process.env.MSSQL_HOST || '127.0.0.1',
    port: Number(process.env.MSSQL_PORT || 1433),
    user: 'sa',
    password: password,
    database: 'master',
    connectTimeout: 5000,
    // The disposable CI container uses its generated self-signed certificate.
    // Production defaults remain rejectUnauthorized:true.
    rejectUnauthorized: false
  });
  try {
    assert.strictEqual(connection.connected, true);
    assert.ok(connection.serverPrelogin);
    assert.ok(connection.loginResponse);
    assert.strictEqual(connection.loginResponse.success, true);
    assert.ok(connection.loginResponse.loginAck);
    assert.ok(connection.packetSize >= 512);
    console.log('NuBloxSQL live SQL Server TDS 8 authentication passed');
  } finally {
    await connection.end();
  }
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
