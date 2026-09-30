'use strict';

var assert = require('assert');
var sql = require('..');

var mysql = sql.createConnection('mysql://alice:secret@db.example.test:3307/app?ssl=false&connectTimeout=2500');
assert.strictEqual(mysql.config.host, 'db.example.test');
assert.strictEqual(mysql.config.port, 3307);
assert.strictEqual(mysql.config.user, 'alice');
assert.strictEqual(mysql.config.password, 'secret');
assert.strictEqual(mysql.config.database, 'app');
assert.strictEqual(mysql.config.ssl, false);
assert.strictEqual(mysql.config.connectTimeout, 2500);

var postgres = sql.createConnection({
  url: 'postgres://bob:p%40ss@pg.example.test:5433/platform?sslmode=require&application_name=nublox',
  database: 'override_db'
});
assert.strictEqual(postgres.config.host, 'pg.example.test');
assert.strictEqual(postgres.config.port, 5433);
assert.strictEqual(postgres.config.user, 'bob');
assert.strictEqual(postgres.config.password, 'p@ss');
assert.strictEqual(postgres.config.database, 'override_db');
assert.strictEqual(postgres.config.ssl, 'require');
assert.strictEqual(postgres.config.applicationName, 'nublox');

var sqlserver = sql.createConnection('mssql://carol:pass@sql.example.test:1444/reporting?queryTimeout=9000&rejectUnauthorized=false');
assert.strictEqual(sqlserver.config.host, 'sql.example.test');
assert.strictEqual(sqlserver.config.port, 1444);
assert.strictEqual(sqlserver.config.user, 'carol');
assert.strictEqual(sqlserver.config.password, 'pass');
assert.strictEqual(sqlserver.config.database, 'reporting');
assert.strictEqual(sqlserver.config.queryTimeout, 9000);
assert.strictEqual(sqlserver.config.rejectUnauthorized, false);

var sqlite = sql.createConnection('sqlite::memory:');
assert.strictEqual(sqlite.filename, ':memory:');
sqlite.close();

var urlObject = new URL('postgresql://dave:pw@localhost/example');
var postgresFromUrl = sql.createConnection(urlObject);
assert.strictEqual(postgresFromUrl.config.user, 'dave');
assert.strictEqual(postgresFromUrl.config.database, 'example');

assert.throws(function () {
  sql.createConnection({ dialect: 'mysql', url: 'postgresql://user:pw@localhost/db' });
}, /does not match explicit dialect/);

assert.throws(function () {
  sql.createConnection('oracle://user:pw@localhost/service');
}, /Unsupported NuBloxSQL connection URL scheme/);

assert.throws(function () {
  sql.createConnection('postgresql:///missing-host');
}, /requires a host/);

assert.throws(function () {
  sql.createConnection('mysql://user:pw@localhost/db?ssl=maybe');
}, /ssl must be a boolean/);

console.log('NuBloxSQL connection URL routing contract passed');
