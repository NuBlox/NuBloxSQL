'use strict';

var assert = require('assert');
var mysql = require('..');

var host = process.env.MYSQL_HOST || '127.0.0.1';
var port = Number(process.env.MYSQL_PORT || 3306);
var database = process.env.MYSQL_DATABASE || 'nublox_ci';
var rootPassword = process.env.MYSQL_ROOT_PASSWORD || 'nublox_root_password';
var password = 'nublox_auth_matrix_password';

function rootConfig() {
  return { host: host, port: port, user: 'root', password: rootPassword, database: database, ssl: false, getServerPublicKey: true };
}

function userConfig(user, extra) {
  return Object.assign({ host: host, port: port, user: user, password: password, database: database, ssl: false, getServerPublicKey: true }, extra || {});
}

async function connectAndSelect(config) {
  var connection = mysql.createConnection(config);
  try {
    await connection.connect();
    var result = await connection.query('SELECT 1 AS ok');
    assert.strictEqual(Number(result.rows[0].ok), 1);
  } finally {
    if (connection.connected && !connection.ended) await connection.end();
  }
}

async function statusValue(root, name) {
  var result = await root.query("SHOW STATUS LIKE '" + name.replace(/'/g, "''") + "'");
  return result.rows.length ? result.rows[0].Value : null;
}

async function accountPlugin(root, user) {
  var result = await root.query("SELECT plugin FROM mysql.user WHERE user = '" + user.replace(/'/g, "''") + "' AND host = '%'");
  return result.rows.length ? result.rows[0].plugin : null;
}

async function main() {
  var root = mysql.createConnection(rootConfig());
  await root.connect();
  var versionResult = await root.query('SELECT VERSION() AS version');
  var serverVersion = String(versionResult.rows[0].version);
  var major = Number(serverVersion.match(/^(\d+)/)[1]);
  var names = ['nublox_auth_cache', 'nublox_auth_sha256', 'nublox_auth_native'];

  try {
    for (var i = 0; i < names.length; i++) await root.query("DROP USER IF EXISTS '" + names[i] + "'@'%'");

    await root.query("CREATE USER 'nublox_auth_cache'@'%' IDENTIFIED WITH caching_sha2_password BY '" + password + "'");
    await root.query("CREATE USER 'nublox_auth_sha256'@'%' IDENTIFIED WITH sha256_password BY '" + password + "'");
    await root.query("GRANT SELECT ON `" + database.replace(/`/g, '``') + "`.* TO 'nublox_auth_cache'@'%'");
    await root.query("GRANT SELECT ON `" + database.replace(/`/g, '``') + "`.* TO 'nublox_auth_sha256'@'%'");

    assert.strictEqual(await accountPlugin(root, 'nublox_auth_cache'), 'caching_sha2_password');
    assert.strictEqual(await accountPlugin(root, 'nublox_auth_sha256'), 'sha256_password');
    await connectAndSelect(userConfig('nublox_auth_cache'));
    await connectAndSelect(userConfig('nublox_auth_sha256'));

    var cachingKey = await statusValue(root, 'Caching_sha2_password_rsa_public_key');
    if (cachingKey) {
      await connectAndSelect(userConfig('nublox_auth_cache', { getServerPublicKey: false, serverPublicKey: cachingKey }));
    }
    var sha256Key = await statusValue(root, 'Rsa_public_key');
    if (sha256Key) {
      await connectAndSelect(userConfig('nublox_auth_sha256', { getServerPublicKey: false, serverPublicKey: sha256Key }));
    }

    await connectAndSelect(userConfig('nublox_auth_cache', { ssl: { mode: 'require', rejectUnauthorized: false }, getServerPublicKey: false }));
    await connectAndSelect(userConfig('nublox_auth_sha256', { ssl: { mode: 'require', rejectUnauthorized: false }, getServerPublicKey: false }));

    var nativeInfo = mysql.authenticationPlugin('mysql_native_password', serverVersion);
    assert.strictEqual(nativeInfo.serverAvailability, major >= 9 ? 'removed' : 'disabled-by-default');
    await assert.rejects(
      root.query("CREATE USER 'nublox_auth_native'@'%' IDENTIFIED WITH mysql_native_password BY '" + password + "'"),
      /native|plugin|loaded|does not exist|unknown/i
    );

    var cacheInfo = mysql.authenticationPlugin('caching_sha2_password', serverVersion);
    var shaInfo = mysql.authenticationPlugin('sha256_password', serverVersion);
    assert.strictEqual(cacheInfo.clientSupport, 'qualified');
    assert.strictEqual(cacheInfo.serverAvailability, 'default');
    assert.strictEqual(shaInfo.clientSupport, 'qualified-deprecated');
    assert.strictEqual(shaInfo.deprecated, true);

    console.log('ok - MySQL ' + serverVersion + ' authentication plugin matrix qualification');
  } finally {
    for (var j = 0; j < names.length; j++) {
      try { await root.query("DROP USER IF EXISTS '" + names[j] + "'@'%'"); } catch (_) {}
    }
    await root.end();
  }
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
