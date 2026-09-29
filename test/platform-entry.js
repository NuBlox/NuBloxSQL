'use strict';

var assert = require('assert');
var sql = require('..');

assert.deepStrictEqual(Object.keys(sql.DIALECTS).sort(), ['mysql', 'postgresql', 'sqlite']);
assert.strictEqual(sql.adapter('mysql'), sql.mysql);
assert.strictEqual(sql.adapter('postgresql'), sql.postgresql);
assert.strictEqual(sql.adapter('postgres'), sql.postgresql);
assert.strictEqual(sql.adapter('pg'), sql.postgresql);
assert.strictEqual(sql.adapter('sqlite'), sql.sqlite);

assert.strictEqual(sql.descriptor('mysql').identity.family, 'mysql');
assert.strictEqual(sql.descriptor('postgresql').identity.family, 'postgresql');
assert.strictEqual(sql.descriptor('sqlite').identity.family, 'sqlite');
assert.strictEqual(sql.supports('mysql', 'preparedStatements'), true);
assert.strictEqual(sql.supports('postgresql', 'serverSideCursors'), true);
assert.strictEqual(sql.supports('sqlite', 'queryCancellation'), false);

var mysqlConnection = sql.createConnection({ dialect: 'mysql', host: '127.0.0.1' });
assert(mysqlConnection instanceof sql.mysql.Connection);

var postgresConnection = sql.createConnection('postgresql', { host: '127.0.0.1' });
assert(postgresConnection instanceof sql.postgresql.Connection);

var sqliteConnection = sql.createConnection({ dialect: 'sqlite', filename: ':memory:' });
assert(sqliteConnection instanceof sql.sqlite.Connection);
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

console.log('NuBloxSQL single-entry platform contract passed');
