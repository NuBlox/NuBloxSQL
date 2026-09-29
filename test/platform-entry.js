'use strict';

var assert = require('assert');

var mysqlPath = require.resolve('../lib/dialects/mysql');
var postgresqlPath = require.resolve('../lib/dialects/postgresql');
var sqlitePath = require.resolve('../lib/dialects/sqlite');
var sqlserverPath = require.resolve('../lib/dialects/sqlserver');
var sqlCorePath = require.resolve('../lib/core');

var sql = require('..');

assert.strictEqual(require.cache[mysqlPath], undefined, 'MySQL must not load with the NuBloxSQL facade');
assert.strictEqual(require.cache[postgresqlPath], undefined, 'PostgreSQL must not load with the NuBloxSQL facade');
assert.strictEqual(require.cache[sqlitePath], undefined, 'SQLite must not load with the NuBloxSQL facade');
assert.strictEqual(require.cache[sqlserverPath], undefined, 'SQL Server must not load with the NuBloxSQL facade');
assert.strictEqual(require.cache[sqlCorePath], undefined, 'SQL Core must not load with the NuBloxSQL facade');

assert.deepStrictEqual(Object.keys(sql.DIALECTS).sort(), ['mysql', 'postgresql', 'sqlite', 'sqlserver']);

var mysql = sql.adapter('mysql');
assert.strictEqual(require.cache[mysqlPath].exports, mysql);
assert.strictEqual(require.cache[postgresqlPath], undefined, 'PostgreSQL must remain unloaded when MySQL is selected');
assert.strictEqual(require.cache[sqlitePath], undefined, 'SQLite must remain unloaded when MySQL is selected');
assert.strictEqual(require.cache[sqlserverPath], undefined, 'SQL Server must remain unloaded when MySQL is selected');
assert.strictEqual(sql.mysql, mysql);

var postgresql = sql.adapter('postgresql');
assert.strictEqual(sql.adapter('postgres'), postgresql);
assert.strictEqual(sql.adapter('pg'), postgresql);
assert.strictEqual(sql.postgresql, postgresql);
assert.strictEqual(require.cache[sqlitePath], undefined, 'SQLite must remain unloaded until selected');
assert.strictEqual(require.cache[sqlserverPath], undefined, 'SQL Server must remain unloaded until selected');

var sqlite = sql.adapter('sqlite');
assert.strictEqual(sql.sqlite, sqlite);
assert.strictEqual(require.cache[sqlserverPath], undefined, 'SQL Server must remain unloaded until selected');

var sqlserver = sql.adapter('sqlserver');
assert.strictEqual(sql.adapter('mssql'), sqlserver);
assert.strictEqual(sql.adapter('sql-server'), sqlserver);
assert.strictEqual(sql.sqlserver, sqlserver);

assert.strictEqual(sql.descriptor('mysql').identity.family, 'mysql');
assert.strictEqual(sql.descriptor('postgresql').identity.family, 'postgresql');
assert.strictEqual(sql.descriptor('sqlite').identity.family, 'sqlite');
assert.strictEqual(sql.descriptor('sqlserver').identity.family, 'sqlserver');
assert.strictEqual(sql.supports('mysql', 'preparedStatements'), true);
assert.strictEqual(sql.supports('postgresql', 'serverSideCursors'), true);
assert.strictEqual(sql.supports('sqlite', 'queryCancellation'), false);
assert.strictEqual(sql.supports('sqlserver', 'rawQuery'), true);
assert.strictEqual(sql.supports('sqlserver', 'preparedStatements'), false);

var mysqlConnection = sql.createConnection({ dialect: 'mysql', host: '127.0.0.1', user: 'test' });
assert(mysqlConnection instanceof mysql.Connection);

var postgresConnection = sql.createConnection('postgresql', { host: '127.0.0.1', user: 'test' });
assert(postgresConnection instanceof postgresql.Connection);

var sqliteConnection = sql.createConnection({ dialect: 'sqlite', filename: ':memory:' });
assert(sqliteConnection instanceof sqlite.Connection);
sqliteConnection.exec('CREATE TABLE sample(id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
sqliteConnection.run('INSERT INTO sample(value) VALUES(?)', ['ok']);
assert.strictEqual(sqliteConnection.query('SELECT value FROM sample').rows[0].value, 'ok');
sqliteConnection.close();

var sqlServerConnection = sql.createConnection({ dialect: 'sqlserver', host: '127.0.0.1', user: 'test' });
assert(sqlServerConnection instanceof sqlserver.Connection);

var sqlServerClient = sql.createClient({ dialect: 'sqlserver', host: '127.0.0.1', user: 'test', pool: false });
var compiledSqlServer = sqlServerClient.compile(sql.sql`SELECT ${42} AS answer`);
assert.strictEqual(compiledSqlServer.text, 'SELECT @p1 AS answer');
assert.deepStrictEqual(compiledSqlServer.parameters, [42]);
assert.strictEqual(sqlServerClient.supports('preparedStatements'), false);

assert.throws(function missingDialect() {
  sql.createConnection({ host: '127.0.0.1' });
}, /requires a dialect/);

assert.throws(function unsupportedDialect() {
  sql.createConnection({ dialect: 'oracle' });
}, /Unsupported NuBloxSQL dialect/);

assert.throws(function sqlitePool() {
  sql.createPool({ dialect: 'sqlite' });
}, /does not support connection pools/);

assert.throws(function sqlServerPool() {
  sql.createPool({ dialect: 'sqlserver' });
}, /does not support connection pools/);

assert.strictEqual(sql.sqlCore, require('../lib/core'));

console.log('NuBloxSQL lazy single-entry platform contract passed');
