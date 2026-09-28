'use strict';
var assert = require('node:assert');
var sqlite = require('..');
var db = sqlite.createConnection();

db.exec('CREATE TABLE unique_item(id INTEGER PRIMARY KEY, code TEXT UNIQUE)');
db.run('INSERT INTO unique_item(code) VALUES(?)', ['A']);
assert.throws(function () {
  db.run('INSERT INTO unique_item(code) VALUES(?)', ['A']);
}, function (error) {
  return error && error.name === 'SqliteError' && error.category === 'constraint' && error.retryable === false;
});

assert.throws(function () { db.query('SELEC broken'); }, function (error) {
  return error && error.name === 'SqliteError' && error.category === 'syntax';
});

db.close();
assert.throws(function () { db.query('SELECT 1'); }, function (error) {
  return error && error.name === 'SqliteError' && error.category === 'state';
});
console.log('ok - SQLite deterministic error classification');
