'use strict';

var assert = require('assert');
var sql = require('..');

var mysqlStatic = sql.capabilityReport('mysql');
assert.strictEqual(mysqlStatic.dialect, 'mysql');
assert.strictEqual(mysqlStatic.identity.family, 'mysql');
assert.strictEqual(mysqlStatic.capabilities.preparedStatements, true);
assert.deepStrictEqual(mysqlStatic.support.preparedStatements, { supported: true, source: 'dialect' });
assert.strictEqual(mysqlStatic.server, null);
assert.strictEqual(typeof mysqlStatic.runtime.nodeVersion, 'string');

var mysqlTarget = {
  connected: true,
  ended: false,
  secure: true,
  server: {
    serverVersion: '9.7.0',
    protocolVersion: 10,
    capabilityFlags: 12345,
    authPluginName: 'caching_sha2_password'
  }
};
var mysqlClient = new sql.Client(sql.adapter('mysql'), 'mysql', {}, mysqlTarget, false);
var mysqlReport = mysqlClient.capabilityReport();
assert.strictEqual(mysqlReport.server.version, '9.7.0');
assert.strictEqual(mysqlReport.server.protocolVersion, 10);
assert.strictEqual(mysqlReport.server.capabilityFlags, 12345);
assert.strictEqual(mysqlReport.server.secure, true);

var pgTarget = {
  connected: true,
  ended: false,
  config: { protocolVersion: 196608 },
  parameters: {
    server_version: '18.1',
    server_encoding: 'UTF8',
    client_encoding: 'UTF8',
    integer_datetimes: 'on'
  }
};
var pgClient = new sql.Client(sql.adapter('postgresql'), 'postgresql', {}, pgTarget, false);
var pgReport = pgClient.capabilityReport();
assert.strictEqual(pgReport.server.version, '18.1');
assert.strictEqual(pgReport.server.serverEncoding, 'UTF8');

var sqlServerTarget = {
  connected: true,
  ended: false,
  serverPrelogin: { encryption: 1 },
  loginResponse: {
    loginAck: {
      tdsVersion: 1946157060,
      programName: 'Microsoft SQL Server',
      programVersion: { major: 16, minor: 0, buildHigh: 4, buildLow: 210 }
    }
  },
  socket: { alpnProtocol: 'tds/8.0' }
};
var sqlServerClient = new sql.Client(sql.adapter('sqlserver'), 'sqlserver', {}, sqlServerTarget, false);
var sqlServerReport = sqlServerClient.capabilityReport();
assert.strictEqual(sqlServerReport.server.productName, 'Microsoft SQL Server');
assert.strictEqual(sqlServerReport.server.version, '16.0.1234');
assert.strictEqual(sqlServerReport.server.alpnProtocol, 'tds/8.0');

(async function () {
  var sqliteClient = sql.createClient({ dialect: 'sqlite', filename: ':memory:', pool: false });
  var before = sqliteClient.capabilityReport();
  assert.strictEqual(before.dialect, 'sqlite');
  assert.strictEqual(before.server.version, process.versions.sqlite || null);
  var discovered = await sqliteClient.discoverCapabilities();
  assert.strictEqual(discovered.server.connected, true);
  assert.strictEqual(discovered.runtime.sqliteVersion, process.versions.sqlite || null);
  await sqliteClient.close();
  console.log('NuBloxSQL capability discovery contract passed');
})().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
