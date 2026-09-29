'use strict';

var assert = require('assert');

var mysqlPath = require.resolve('../packages/mysql');
var postgresqlPath = require.resolve('../packages/postgresql');
var sqlitePath = require.resolve('../packages/sqlite');
var sqlCorePath = require.resolve('../packages/sql-core');

var sql = require('..');

assert.strictEqual(require.cache[mysqlPath], undefined, 'MySQL must not load with the NuBloxSQL facade');
assert.strictEqual(require.cache[postgresqlPath], undefined, 'PostgreSQL must not load with the NuBloxSQL facade');
assert.strictEqual(require.cache[sqlitePath], undefined, 'SQLite must not load with the NuBloxSQL facade');
assert.strictEqual(require.cache[sqlCorePath], undefined, 'SQL Core must not load with the NuBloxSQL facade');

assert.deepStrictEqual(Object.keys(sql.DIALECTS).sort(), ['mysql', 'postgresql', 'sqlite']);

var mysql = sql.adapter('mysql');
assert.strictEqual(require.cache[mysqlPath].exports, mysql);
assert.strictEqual(require.cache[postgresqlPath], undefined, 'PostgreSQL must remain unloaded when MySQL is selected');
assert.strictEqual(require.cache[sqlitePath], undefined, 'SQLite must remain unloaded when MySQL is selected');
assert.strictEqual(sql.mysql, mysql);

var postgresql = sql.adapter('postgresql');
assert.strictEqual(sql.adapter('postgres'), postgresql);
assert.strictEqual(sql.adapter('pg'), postgresql);
assert.strictEqual(sql.postgresql, postgresql);
assert.strictEqual(require.cache[sqlitePath], undefined, 'SQLite must remain unloaded until selected');

var sqlite = sql.adapter('sqlite');
assert.strictEqual(sql.sqlite, sqlite);

assert.strictEqual(sql.descriptor('mysql').identity.family, 'mysql');
assert.strictEqual(sql.descriptor('postgresql').identity.family, 'postgresql');
assert.strictEqual(sql.descriptor('sqlite').identity.family, 'sqlite');
assert.strictEqual(sql.supports('mysql', 'preparedStatements'), true);
assert.strictEqual(sql.supports('postgresql', 'serverSideCursors'), true);
assert.strictEqual(sql.supports('sqlite', 'queryCancellation'), false);

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

assert.throws(function missingDialect() {
  sql.createConnection({ host: '127.0.0.1' });
}, /requires a dialect/);

assert.throws(function unsupportedDialect() {
  sql.createConnection({ dialect: 'oracle' });
}, /Unsupported NuBloxSQL dialect/);

assert.throws(function sqlitePool() {
  sql.createPool({ dialect: 'sqlite' });
}, /does not support connection pools/);

assert.strictEqual(sql.sqlCore, require('../packages/sql-core'));

console.log('NuBloxSQL lazy single-entry platform contract passed');
