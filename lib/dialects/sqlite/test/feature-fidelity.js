'use strict';

var assert = require('assert');
var sqlite = require('../index');

var db = sqlite.createConnection({ readBigInts: true });
try {
  db.exec('CREATE TABLE fidelity (id INTEGER PRIMARY KEY, big_value INTEGER, blob_value BLOB, timestamp_value TEXT, flag INTEGER)');
  var big = 9007199254740993n;
  var blob = new Uint8Array([0, 1, 127, 128, 254, 255]);
  var timestamp = new Date('2026-09-30T21:50:34.123Z').toISOString();
  db.run('INSERT INTO fidelity(id, big_value, blob_value, timestamp_value, flag) VALUES (?, ?, ?, ?, ?)', [1n, big, blob, timestamp, 1n]);

  var row = db.query('SELECT big_value, blob_value, timestamp_value, flag FROM fidelity').rows[0];
  assert.strictEqual(row.big_value, big);
  assert.ok(row.blob_value instanceof Uint8Array);
  assert.deepStrictEqual(Array.from(row.blob_value), Array.from(blob));
  assert.strictEqual(row.timestamp_value, timestamp);
  assert.strictEqual(row.flag, 1n);

  var matrix = db.featureMatrix();
  assert.ok(Object.isFrozen(matrix));
  assert.ok(Object.isFrozen(matrix.features));
  assert.ok(Object.isFrozen(matrix.valueConventions));
  assert.ok(/^\d+\.\d+\.\d+/.test(matrix.sqliteVersion));
  assert.strictEqual(matrix.valueConventions.integer, 'bigint');
  assert.strictEqual(matrix.valueConventions.blob, 'Uint8Array');
  assert.strictEqual(matrix.valueConventions.dateTime, 'ISO-8601-UTC-text-by-convention');
  assert.strictEqual(matrix.valueConventions.boolean, 'integer-0-or-1-by-convention');

  assert.strictEqual(matrix.features.commonTableExpressions, true);
  assert.strictEqual(matrix.features.windowFunctions, true);
  assert.strictEqual(matrix.features.returning, true);
  assert.strictEqual(matrix.features.upsert, true);
  assert.strictEqual(matrix.features.strictTables, true);
  assert.strictEqual(matrix.features.builtInCollations, true);
  assert.strictEqual(typeof matrix.features.json, 'boolean');
  assert.strictEqual(typeof matrix.features.jsonb, 'boolean');
  assert.strictEqual(typeof matrix.features.fts5, 'boolean');
  assert.strictEqual(typeof matrix.features.customCollations, 'boolean');
  assert.ok(Array.isArray(matrix.compileOptions));

  var nocase = db.query("SELECT 'NuBlox' = 'nublox' COLLATE NOCASE AS equal_value").rows[0];
  assert.strictEqual(nocase.equal_value, 1n);

  if (matrix.features.json) {
    var jsonRow = db.query("SELECT json_extract('{\"name\":\"NuBlox\"}', '$.name') AS name").rows[0];
    assert.strictEqual(jsonRow.name, 'NuBlox');
  }
  if (matrix.features.jsonb) {
    var jsonbRow = db.query("SELECT typeof(jsonb('{\"name\":\"NuBlox\"}')) AS storage").rows[0];
    assert.strictEqual(jsonbRow.storage, 'blob');
  }

  var conventions = db.valueConventions();
  assert.deepStrictEqual(conventions, matrix.valueConventions);

  var numberDb = sqlite.createConnection();
  try {
    assert.strictEqual(numberDb.valueConventions().integer, 'number-safe-integer');
    assert.throws(function () {
      numberDb.query('SELECT 9007199254740993 AS value');
    });
  } finally {
    numberDb.close();
  }

  console.log('SQLite feature matrix and value fidelity contract passed');
} finally {
  db.close();
}
