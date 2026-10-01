'use strict';

var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var sqlite = require('..');

var MIB = 1024 * 1024;
var FIXTURE_ROWS = 20000;
var PAYLOAD_BYTES = 512;
var LONG_LIVED_READS = 25000;

var CEILINGS = Object.freeze({
  materializationPeakHeapBytes: 256 * MIB,
  materializationPeakRssBytes: 384 * MIB,
  materializationRetainedHeapBytes: 64 * MIB,
  materializationRetainedRssBytes: 256 * MIB,
  longLivedRetainedHeapBytes: 64 * MIB,
  longLivedRetainedRssBytes: 256 * MIB
});

function requireGc() {
  assert.strictEqual(typeof global.gc, 'function', 'SQLite memory qualification requires Node.js --expose-gc');
}

function forceGc() {
  requireGc();
  for (var i = 0; i < 3; i += 1) global.gc();
}

function snapshot() {
  var usage = process.memoryUsage();
  return Object.freeze({
    rssBytes: usage.rss,
    heapTotalBytes: usage.heapTotal,
    heapUsedBytes: usage.heapUsed,
    externalBytes: usage.external,
    arrayBuffersBytes: usage.arrayBuffers
  });
}

function delta(after, before) {
  return Object.freeze({
    rssBytes: after.rssBytes - before.rssBytes,
    heapTotalBytes: after.heapTotalBytes - before.heapTotalBytes,
    heapUsedBytes: after.heapUsedBytes - before.heapUsedBytes,
    externalBytes: after.externalBytes - before.externalBytes,
    arrayBuffersBytes: after.arrayBuffersBytes - before.arrayBuffersBytes
  });
}

function nonNegative(value) {
  return Math.max(0, value);
}

function assertCeiling(label, value, ceiling) {
  assert.ok(
    nonNegative(value) <= ceiling,
    label + ' exceeded qualification ceiling of ' + ceiling + ' bytes: ' + value
  );
}

function run() {
  requireGc();

  var directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nublox-sqlite-memory-'));
  var filename = path.join(directory, 'qualification.sqlite');
  var db = sqlite.createConnection({
    filename: filename,
    journalMode: 'wal',
    synchronous: 'normal',
    busyTimeout: 5000
  });

  var metrics = {
    node: process.version,
    sqlite: db.query('SELECT sqlite_version() AS version').rows[0].version,
    filenameMode: 'file-backed',
    fixture: Object.freeze({ rows: FIXTURE_ROWS, payloadBytesPerRow: PAYLOAD_BYTES }),
    longLivedReads: LONG_LIVED_READS,
    ceilings: CEILINGS
  };

  try {
    db.exec('CREATE TABLE bench(id INTEGER PRIMARY KEY, category TEXT NOT NULL, payload TEXT NOT NULL)');
    db.exec('CREATE INDEX idx_bench_category ON bench(category)');

    var insert = db.prepare('INSERT INTO bench(category, payload) VALUES (?, ?)');
    var payload = 'x'.repeat(PAYLOAD_BYTES);
    db.transaction(function () {
      for (var i = 0; i < FIXTURE_ROWS; i += 1) {
        insert.run(['category-' + (i % 100), payload + String(i)]);
      }
    });

    forceGc();
    var materializationBaseline = snapshot();
    var materialized = db.query('SELECT id, category, payload FROM bench ORDER BY id');
    assert.strictEqual(materialized.rowCount, FIXTURE_ROWS);
    assert.strictEqual(materialized.rows.length, FIXTURE_ROWS);
    assert.strictEqual(materialized.rows[0].id, 1);
    assert.strictEqual(materialized.rows[FIXTURE_ROWS - 1].id, FIXTURE_ROWS);
    var materializationPeak = snapshot();
    var materializationPeakDelta = delta(materializationPeak, materializationBaseline);

    assertCeiling(
      'materialization peak heap growth',
      materializationPeakDelta.heapUsedBytes,
      CEILINGS.materializationPeakHeapBytes
    );
    assertCeiling(
      'materialization peak RSS growth',
      materializationPeakDelta.rssBytes,
      CEILINGS.materializationPeakRssBytes
    );

    materialized = null;
    forceGc();
    var materializationAfterGc = snapshot();
    var materializationRetainedDelta = delta(materializationAfterGc, materializationBaseline);

    assertCeiling(
      'materialization retained heap growth',
      materializationRetainedDelta.heapUsedBytes,
      CEILINGS.materializationRetainedHeapBytes
    );
    assertCeiling(
      'materialization retained RSS growth',
      materializationRetainedDelta.rssBytes,
      CEILINGS.materializationRetainedRssBytes
    );

    metrics.materialization = Object.freeze({
      baseline: materializationBaseline,
      peak: materializationPeak,
      peakDelta: materializationPeakDelta,
      afterGc: materializationAfterGc,
      retainedDelta: materializationRetainedDelta
    });

    forceGc();
    var longLivedBaseline = snapshot();
    var preparedRead = db.prepare('SELECT payload FROM bench WHERE id = ?');
    for (var read = 0; read < LONG_LIVED_READS; read += 1) {
      var id = (read % FIXTURE_ROWS) + 1;
      var row = preparedRead.get([id]);
      assert.ok(row && typeof row.payload === 'string');
      if (read % 250 === 0) {
        assert.ok(db.listTables().some(function (entry) { return entry.name === 'bench'; }));
        assert.ok(db.tableInfo('bench').length >= 3);
      }
    }

    forceGc();
    var longLivedAfterGc = snapshot();
    var longLivedRetainedDelta = delta(longLivedAfterGc, longLivedBaseline);

    assertCeiling(
      'long-lived connection retained heap growth',
      longLivedRetainedDelta.heapUsedBytes,
      CEILINGS.longLivedRetainedHeapBytes
    );
    assertCeiling(
      'long-lived connection retained RSS growth',
      longLivedRetainedDelta.rssBytes,
      CEILINGS.longLivedRetainedRssBytes
    );

    metrics.longLivedConnection = Object.freeze({
      baseline: longLivedBaseline,
      afterGc: longLivedAfterGc,
      retainedDelta: longLivedRetainedDelta
    });

    var state = db.storageState();
    assert.strictEqual(String(state.journalMode).toLowerCase(), 'wal');
    metrics.storage = Object.freeze({
      pageCount: state.pageCount,
      pageSize: state.pageSize,
      journalMode: state.journalMode
    });

    console.log('NUBLOX_SQLITE_PRODUCTION_MEMORY ' + JSON.stringify(metrics));
  } finally {
    try { db.close(); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }
}

run();
