'use strict';

var assert = require('node:assert');
var sqlite = require('..');

function directPreparedBatchContract() {
  var db = sqlite.createConnection();
  try {
    db.exec('CREATE TABLE batch_item(id INTEGER PRIMARY KEY, name TEXT, active INTEGER NOT NULL, payload BLOB)');
    var result = db.insertMany(
      ['batch_item'],
      ['id', 'name', 'active', 'payload'],
      [
        { id: 1, name: 'Ada', active: true, payload: Buffer.from([1, 2]) },
        { id: 2, name: 'Grace', active: false, payload: null },
        { id: 3, name: null, active: true, payload: new Uint8Array([170]) }
      ]
    );

    assert.ok(result);
    assert.strictEqual(result.strategy, 'sqlite-prepared-transaction');
    assert.strictEqual(result.rowCount, 3);
    assert.strictEqual(result.affectedRows, 3n);
    var rows = db.query('SELECT id, name, active, payload FROM batch_item ORDER BY id').rows;
    assert.deepStrictEqual(rows.map(function (row) {
      return {
        id: row.id,
        name: row.name,
        active: row.active,
        payload: row.payload === null ? null : Array.from(row.payload)
      };
    }), [
      { id: 1, name: 'Ada', active: 1, payload: [1, 2] },
      { id: 2, name: 'Grace', active: 0, payload: null },
      { id: 3, name: null, active: 1, payload: [170] }
    ]);
  } finally {
    db.close();
  }
}

function atomicRollbackContract() {
  var db = sqlite.createConnection();
  try {
    db.exec('CREATE TABLE rollback_item(id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL)');
    assert.throws(function () {
      db.insertMany(
        ['rollback_item'],
        ['id', 'code'],
        [
          { id: 1, code: 'duplicate' },
          { id: 2, code: 'duplicate' }
        ]
      );
    }, function (error) {
      return error && error.category === 'constraint';
    });
    assert.strictEqual(db.query('SELECT COUNT(*) AS count FROM rollback_item').rows[0].count, 0);

    db.begin('immediate');
    assert.throws(function () {
      db.insertMany(['rollback_item'], ['id', 'code'], [{ id: 3, code: 'outer' }]);
    }, /requires ownership of the batch transaction/);
    assert.strictEqual(db.isTransaction(), true);
    db.rollback();
  } finally {
    db.close();
  }
}

function unsupportedValueContract() {
  var db = sqlite.createConnection();
  try {
    db.exec('CREATE TABLE unsupported_item(id INTEGER PRIMARY KEY, payload TEXT)');
    var result = db.insertMany(
      ['unsupported_item'],
      ['id', 'payload'],
      [{ id: 1, payload: { nested: true } }]
    );
    assert.strictEqual(result, null);
    assert.strictEqual(db.query('SELECT COUNT(*) AS count FROM unsupported_item').rows[0].count, 0);
  } finally {
    db.close();
  }
}

function highColumnBatchContract() {
  var db = sqlite.createConnection();
  try {
    var columns = [];
    for (var c = 1; c <= 70; c += 1) columns.push('c' + c);
    db.exec('CREATE TABLE wide_item(' + columns.map(function (name) {
      return '"' + name + '" INTEGER NOT NULL';
    }).join(', ') + ')');

    var rows = [];
    for (var r = 0; r < 500; r += 1) {
      var row = {};
      for (var i = 0; i < columns.length; i += 1) row[columns[i]] = r * 100 + i;
      rows.push(row);
    }

    var result = db.insertMany(['wide_item'], columns, rows);
    assert.strictEqual(result.rowCount, 500);
    assert.strictEqual(result.affectedRows, 500n);
    assert.strictEqual(db.query('SELECT COUNT(*) AS count FROM wide_item').rows[0].count, 500);
  } finally {
    db.close();
  }
}

directPreparedBatchContract();
atomicRollbackContract();
unsupportedValueContract();
highColumnBatchContract();

console.log('ok - SQLite prepared transactional batch writer');
