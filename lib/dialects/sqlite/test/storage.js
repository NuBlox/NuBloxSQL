'use strict';

var assert = require('node:assert');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var sqlite = require('..');

var root = fs.mkdtempSync(path.join(os.tmpdir(), 'nubloxsql-sqlite-storage-'));
var filename = path.join(root, 'app.db');

try {
  var db = sqlite.createConnection({ filename: filename, productionDefaults: true });
  var policy = db.storagePolicy();
  assert.strictEqual(policy.journalMode, 'wal');
  assert.strictEqual(policy.synchronous, 'normal');
  assert.strictEqual(policy.lockingMode, 'normal');
  assert.strictEqual(policy.busyTimeout, 5000);
  assert.strictEqual(policy.walAutoCheckpoint, 1000);

  var state = db.storageState();
  assert.strictEqual(state.database, 'main');
  assert.strictEqual(state.journalMode, 'wal');
  assert.strictEqual(state.synchronous, 1);
  assert.strictEqual(state.lockingMode, 'normal');
  assert.strictEqual(state.busyTimeout, 5000);
  assert.strictEqual(state.walAutoCheckpoint, 1000);
  assert.ok(state.pageSize > 0);

  db.exec('CREATE TABLE item(id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  for (var i = 0; i < 20; i++) db.run('INSERT INTO item(value) VALUES(?)', ['v' + i]);
  var checkpoint = db.checkpoint('passive');
  assert.strictEqual(checkpoint.database, 'main');
  assert.strictEqual(checkpoint.mode, 'passive');
  assert.ok(checkpoint.logFrames >= 0);
  assert.ok(checkpoint.checkpointedFrames >= 0);

  db.attach(':memory:', 'scratch');
  db.exec('CREATE TABLE scratch.note(id INTEGER PRIMARY KEY, value TEXT)');
  var attachedState = db.storageState('scratch');
  assert.strictEqual(attachedState.database, 'scratch');
  assert.ok(attachedState.pageSize > 0);
  db.detach('scratch');
  db.close();

  var custom = sqlite.createConnection({ filename: filename, journalMode: 'delete', synchronous: 'full', lockingMode: 'normal', busyTimeout: 1234, walAutoCheckpoint: 77, cacheSize: -2048 });
  var customState = custom.storageState();
  assert.strictEqual(customState.journalMode, 'delete');
  assert.strictEqual(customState.synchronous, 2);
  assert.strictEqual(customState.busyTimeout, 1234);
  assert.strictEqual(customState.walAutoCheckpoint, 77);
  assert.strictEqual(customState.cacheSize, -2048);
  custom.close();

  assert.throws(function () { sqlite.createConnection({ journalMode: 'banana' }); }, RangeError);
  assert.throws(function () { sqlite.createConnection({ busyTimeout: -1 }); }, RangeError);
  assert.throws(function () { sqlite.createConnection({ walAutoCheckpoint: 1.5 }); }, RangeError);

  console.log('ok - SQLite storage, WAL, checkpoint and concurrency policy');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
