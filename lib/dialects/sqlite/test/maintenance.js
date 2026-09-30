'use strict';

var assert = require('node:assert');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var sqlite = require('..');

var directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nubloxsql-sqlite-maintenance-'));
var filename = path.join(directory, 'main.db');
var compacted = path.join(directory, 'compacted.db');

try {
  var db = sqlite.createConnection({ filename: filename, foreignKeys: false });

  db.exec('PRAGMA auto_vacuum = INCREMENTAL');
  db.exec('VACUUM');
  db.exec('CREATE TABLE parent(id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
  db.exec('CREATE TABLE child(id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id), note TEXT)');
  db.exec('CREATE INDEX idx_child_parent ON child(parent_id)');
  db.exec("INSERT INTO child(id, parent_id, note) VALUES (1, 999, 'orphan')");

  var integrity = db.integrityCheck();
  assert.strictEqual(integrity.database, 'main');
  assert.strictEqual(integrity.kind, 'integrity');
  assert.strictEqual(integrity.ok, true);
  assert.deepStrictEqual(Array.from(integrity.messages), ['ok']);
  assert.ok(Object.isFrozen(integrity));

  var quick = db.quickCheck({ maxErrors: 10 });
  assert.strictEqual(quick.kind, 'quick');
  assert.strictEqual(quick.ok, true);

  var foreignKeys = db.foreignKeyCheck();
  assert.strictEqual(foreignKeys.ok, false);
  assert.strictEqual(foreignKeys.violations.length, 1);
  assert.strictEqual(foreignKeys.violations[0].table, 'child');
  assert.strictEqual(foreignKeys.violations[0].parent, 'parent');
  assert.strictEqual(foreignKeys.violations[0].foreignKeyId, 0);

  var childOnly = db.foreignKeyCheck({ table: 'child' });
  assert.strictEqual(childOnly.violations.length, 1);

  db.exec('INSERT INTO parent(id, name) VALUES (999, \'restored\')');
  assert.strictEqual(db.foreignKeyCheck().ok, true);

  var analyzed = db.analyze({ target: 'child' });
  assert.deepStrictEqual(analyzed, Object.freeze({ database: 'main', target: 'child' }));
  assert.ok(db.query("SELECT name FROM sqlite_schema WHERE name = 'sqlite_stat1'").rows.length === 1);

  var optimized = db.optimize();
  assert.strictEqual(optimized.database, 'main');
  assert.strictEqual(optimized.mask, null);
  assert.ok(Array.isArray(optimized.native));

  db.exec("INSERT INTO child(id, parent_id, note) VALUES (2, 999, 'delete me')");
  db.exec('DELETE FROM child WHERE id = 2');
  var incremental = db.incrementalVacuum(1);
  assert.strictEqual(incremental.database, 'main');
  assert.strictEqual(incremental.pages, 1);

  var vacuumed = db.vacuum({ into: compacted });
  assert.strictEqual(vacuumed.database, 'main');
  assert.strictEqual(vacuumed.into, compacted);
  assert.strictEqual(fs.existsSync(compacted), true);

  var copy = sqlite.createConnection({ filename: compacted, mode: 'readonly' });
  assert.strictEqual(copy.integrityCheck().ok, true);
  assert.strictEqual(copy.query('SELECT COUNT(*) AS count FROM child').rows[0].count, 1);
  copy.close();

  db.attach(':memory:', 'archive');
  db.exec('CREATE TABLE archive.audit(id INTEGER PRIMARY KEY, note TEXT NOT NULL)');
  assert.strictEqual(db.quickCheck({ database: 'archive' }).ok, true);
  assert.strictEqual(db.foreignKeyCheck({ database: 'archive' }).ok, true);
  db.detach('archive');

  assert.throws(function () { db.integrityCheck({ maxErrors: 0 }); }, RangeError);
  assert.throws(function () { db.foreignKeyCheck({ table: 'not-valid!' }); }, TypeError);
  assert.throws(function () { db.optimize({ mask: -1 }); }, RangeError);
  assert.throws(function () { db.incrementalVacuum(-1); }, RangeError);

  db.close();
  console.log('ok - SQLite integrity diagnostics and maintenance contracts');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
