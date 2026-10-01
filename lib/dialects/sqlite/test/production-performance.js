'use strict';

var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var performance = require('perf_hooks').performance;
var sqlite = require('..');

function elapsed(start) { return Math.max(0.001, performance.now() - start); }
function rate(count, milliseconds) { return Number((count / (milliseconds / 1000)).toFixed(2)); }
function round(milliseconds) { return Number(milliseconds.toFixed(2)); }

var CEILINGS = Object.freeze({
  simpleReadsMs: 10000,
  preparedReadsMs: 10000,
  autocommitWritesMs: 15000,
  transactionWritesMs: 10000,
  materializeMs: 10000,
  iterateMs: 10000,
  metadataMs: 10000
});

function assertWithin(name, milliseconds) {
  assert.ok(milliseconds <= CEILINGS[name], name + ' exceeded qualification ceiling of ' + CEILINGS[name] + ' ms: ' + milliseconds.toFixed(2));
}

function scenario(metrics, name, count, fn) {
  var started = performance.now();
  var result = fn();
  var milliseconds = elapsed(started);
  assertWithin(name + 'Ms', milliseconds);
  metrics[name] = Object.freeze({
    operations: count,
    milliseconds: round(milliseconds),
    operationsPerSecond: rate(count, milliseconds),
    ceilingMilliseconds: CEILINGS[name + 'Ms']
  });
  return result;
}

function run() {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nublox-sqlite-perf-'));
  var filename = path.join(directory, 'qualification.sqlite');
  var db = sqlite.createConnection({ filename: filename, journalMode: 'wal', synchronous: 'normal', busyTimeout: 5000 });
  var metrics = {
    node: process.version,
    sqlite: db.query('SELECT sqlite_version() AS version').rows[0].version,
    filenameMode: 'file-backed',
    journalMode: String(db.storageState().journalMode || '').toLowerCase(),
    ceilings: CEILINGS
  };

  try {
    db.exec('CREATE TABLE bench(id INTEGER PRIMARY KEY, category TEXT NOT NULL, payload TEXT NOT NULL)');
    db.exec('CREATE INDEX idx_bench_category ON bench(category)');

    scenario(metrics, 'simpleReads', 1000, function () {
      for (var i = 0; i < 1000; i += 1) {
        var result = db.query('SELECT ' + i + ' AS value');
        assert.strictEqual(result.rows[0].value, i);
      }
    });

    var preparedRead = db.prepare('SELECT ? AS value');
    scenario(metrics, 'preparedReads', 5000, function () {
      for (var i = 0; i < 5000; i += 1) assert.strictEqual(preparedRead.get([i]).value, i);
    });

    var autocommitInsert = db.prepare('INSERT INTO bench(category, payload) VALUES (?, ?)');
    scenario(metrics, 'autocommitWrites', 250, function () {
      for (var i = 0; i < 250; i += 1) autocommitInsert.run(['auto-' + (i % 10), 'payload-' + i]);
    });

    var transactionInsert = db.prepare('INSERT INTO bench(category, payload) VALUES (?, ?)');
    scenario(metrics, 'transactionWrites', 5000, function () {
      db.transaction(function () {
        for (var i = 0; i < 5000; i += 1) transactionInsert.run(['tx-' + (i % 20), 'x'.repeat(64)]);
      });
    });

    db.transaction(function () {
      var seed = db.prepare('INSERT INTO bench(category, payload) VALUES (?, ?)');
      for (var i = 0; i < 5000; i += 1) seed.run(['seed-' + (i % 50), 'y'.repeat(128)]);
    });

    scenario(metrics, 'materialize', 1, function () {
      var result = db.query('SELECT id, category, payload FROM bench ORDER BY id');
      assert.ok(result.rowCount >= 10000, 'materialization fixture must contain at least 10k rows');
      metrics.materializedRows = result.rowCount;
    });

    var iterateStatement = db.prepare('SELECT id, category, payload FROM bench ORDER BY id');
    scenario(metrics, 'iterate', 1, function () {
      var count = 0;
      for (var row of iterateStatement.iterate()) {
        count += 1;
        assert.ok(row.id > 0);
      }
      assert.ok(count >= 10000);
      metrics.iteratedRows = count;
    });

    scenario(metrics, 'metadata', 500, function () {
      for (var i = 0; i < 250; i += 1) {
        assert.ok(db.listTables().some(function (entry) { return entry.name === 'bench'; }));
        assert.ok(db.tableInfo('bench').length >= 3);
      }
    });

    var state = db.storageState();
    assert.strictEqual(String(state.journalMode).toLowerCase(), 'wal');
    metrics.storage = Object.freeze({ pageCount: state.pageCount, pageSize: state.pageSize, journalMode: state.journalMode });

    console.log('NUBLOX_SQLITE_PRODUCTION_PERFORMANCE ' + JSON.stringify(metrics));
  } finally {
    try { db.close(); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }
}

run();
