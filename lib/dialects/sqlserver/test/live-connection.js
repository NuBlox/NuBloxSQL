'use strict';

var assert = require('assert');
var net = require('net');
var sqlserver = require('..');

function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

function probeTcp(host, port, timeoutMs) {
  return new Promise(function (resolve) {
    var socket = net.connect({ host: host, port: port });
    var settled = false;
    function finish(ok) {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    }
    socket.setTimeout(timeoutMs, function () { finish(false); });
    socket.once('connect', function () { finish(true); });
    socket.once('error', function () { finish(false); });
  });
}

async function waitForServer(host, port) {
  for (var attempt = 1; attempt <= 90; attempt++) {
    if (await probeTcp(host, port, 1000)) return;
    await sleep(1000);
  }
  throw new Error('SQL Server did not begin listening on ' + host + ':' + port + ' within 90 seconds');
}

async function connectWithRetry(config) {
  var lastError;
  for (var attempt = 1; attempt <= 3; attempt++) {
    var connection = sqlserver.createConnection(config);
    try {
      await connection.connect();
      return connection;
    } catch (error) {
      lastError = error;
      try { await connection.end(); } catch (_) {}
      if (attempt < 3) await sleep(1000);
    }
  }
  throw lastError;
}

async function main() {
  var password = process.env.MSSQL_SA_PASSWORD;
  if (!password) throw new Error('MSSQL_SA_PASSWORD is required');
  var host = process.env.MSSQL_HOST || '127.0.0.1';
  var port = Number(process.env.MSSQL_PORT || 1433);

  await waitForServer(host, port);

  var connection = await connectWithRetry({
    host: host,
    port: port,
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
