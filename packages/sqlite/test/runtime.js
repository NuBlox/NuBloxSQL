'use strict';
var assert = require('node:assert');
var sqlite = require('..');

var db = sqlite.createConnection({ readBigInts: true });
assert.strictEqual(sqlite.descriptor.identity.family, 'sqlite');
assert.strictEqual(sqlite.services.placeholder(2), '?');
assert.strictEqual(sqlite.services.quoteIdentifier('a"b'), '"a""b"');
assert.strictEqual(sqlite.capabilities.preparedStatements, true);
assert.strictEqual(sqlite.capabilities.serverSideCursors, false);

db.exec('CREATE TABLE item(id INTEGER PRIMARY KEY, name TEXT NOT NULL, qty INTEGER NOT NULL);');
var insert = db.prepare('INSERT INTO item(name, qty) VALUES(?, ?)');
var result = insert.run(['alpha', 2n]);
assert.strictEqual(result.kind, 'command');
assert.strictEqual(result.affectedRows, 1n);
assert.strictEqual(result.insertId, 1n);

var rows = db.query('SELECT id, name, qty FROM item ORDER BY id');
assert.strictEqual(rows.kind, 'rows');
assert.deepStrictEqual(rows.rows, [{ id: 1n, name: 'alpha', qty: 2n }]);
assert.strictEqual(rows.fields[0].name, 'id');

db.transaction(function (tx) {
  tx.run('INSERT INTO item(name, qty) VALUES(?, ?)', ['beta', 3n]);
  tx.savepoint('inner');
  tx.run('INSERT INTO item(name, qty) VALUES(?, ?)', ['gamma', 4n]);
  tx.rollbackTo('inner');
  tx.release('inner');
});
assert.deepStrictEqual(db.query('SELECT name FROM item ORDER BY id').rows.map(function (row) { return row.name; }), ['alpha', 'beta']);

assert.throws(function () {
  db.query('SELECT id, name FROM item ORDER BY id', undefined, { maxRows: 1 });
}, function (error) { return error && error.name === 'SqliteResultLimitError' && error.category === 'resource-limit'; });

assert.ok(db.listDatabases().some(function (entry) { return entry.name === 'main'; }));
assert.ok(db.listTables().some(function (entry) { return entry.name === 'item'; }));
assert.ok(db.tableInfo('item').some(function (column) { return column.name === 'name'; }));

db.close();
assert.strictEqual(db.closed, true);
console.log('ok - SQLite runtime, transaction, limits and introspection contracts');
