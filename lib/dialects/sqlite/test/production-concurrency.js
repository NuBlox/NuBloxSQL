'use strict';

var assert = require('node:assert');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var performance = require('node:perf_hooks').performance;
var sqlite = require('..');

var BUSY_TIMEOUT_MS = 150;
var FAIRNESS_ROUNDS = 20;

function elapsed(started) {
  return Number((performance.now() - started).toFixed(2));
}

function assertBusy(fn, label) {
  var started = performance.now();
  var captured = null;
  try {
    fn();
  } catch (error) {
    captured = error;
  }
  var milliseconds = elapsed(started);
  assert.ok(captured, label + ' must fail while the competing lock is held');
  assert.strictEqual(captured.category, 'timeout', label + ' must classify SQLITE_BUSY/LOCKED as timeout');
  assert.strictEqual(captured.retryable, true, label + ' must be retryable');
  assert.ok(milliseconds < 5000, label + ' must remain bounded by the busy-timeout policy');
  return Object.freeze({ milliseconds: milliseconds, category: captured.category, retryable: captured.retryable });
}

function openPair(filename, journalMode) {
  var options = {
    filename: filename,
    journalMode: journalMode,
    synchronous: 'normal',
    lockingMode: 'normal',
    busyTimeout: BUSY_TIMEOUT_MS,
    walAutoCheckpoint: 8
  };
  return {
    first: sqlite.createConnection(options),
    second: sqlite.createConnection(options)
  };
}

function seed(filename, journalMode) {
  var db = sqlite.createConnection({
    filename: filename,
    journalMode: journalMode,
    synchronous: 'normal',
    busyTimeout: BUSY_TIMEOUT_MS
  });
  try {
    db.exec('CREATE TABLE contention(id INTEGER PRIMARY KEY, owner TEXT NOT NULL, sequence_no INTEGER NOT NULL)');
  } finally {
    db.close();
  }
}

function qualifyWal(filename) {
  seed(filename, 'wal');
  var pair = openPair(filename, 'wal');
  var writer = pair.first;
  var contender = pair.second;
  var evidence = { mode: 'wal' };

  try {
    assert.strictEqual(String(writer.storageState().journalMode).toLowerCase(), 'wal');
    assert.strictEqual(String(contender.storageState().journalMode).toLowerCase(), 'wal');

    writer.exec('BEGIN IMMEDIATE');
    writer.run('INSERT INTO contention(owner, sequence_no) VALUES(?, ?)', ['writer', 1]);

    var concurrentRead = contender.query('SELECT COUNT(*) AS count FROM contention').rows[0].count;
    assert.strictEqual(concurrentRead, 0, 'WAL readers must retain their committed snapshot while a writer is active');

    evidence.writerContention = assertBusy(function () {
      contender.run('INSERT INTO contention(owner, sequence_no) VALUES(?, ?)', ['contender', 1]);
    }, 'WAL competing writer');

    writer.exec('COMMIT');
    contender.run('INSERT INTO contention(owner, sequence_no) VALUES(?, ?)', ['contender', 1]);

    contender.exec('BEGIN');
    var readerSnapshot = contender.query('SELECT COUNT(*) AS count FROM contention').rows[0].count;
    writer.run('INSERT INTO contention(owner, sequence_no) VALUES(?, ?)', ['writer', 2]);
    assert.strictEqual(
      contender.query('SELECT COUNT(*) AS count FROM contention').rows[0].count,
      readerSnapshot,
      'WAL read transaction must keep a stable snapshot across concurrent commits'
    );

    var blockedCheckpoint = writer.checkpoint('restart');
    assert.ok(blockedCheckpoint.busy >= 0);
    evidence.readerCheckpoint = Object.freeze({
      busy: blockedCheckpoint.busy,
      logFrames: blockedCheckpoint.logFrames,
      checkpointedFrames: blockedCheckpoint.checkpointedFrames
    });

    contender.exec('COMMIT');
    var finalCheckpoint = writer.checkpoint('truncate');
    assert.strictEqual(finalCheckpoint.busy, 0, 'WAL checkpoint must complete after the reader releases its snapshot');
    evidence.recoveredCheckpoint = Object.freeze({
      busy: finalCheckpoint.busy,
      logFrames: finalCheckpoint.logFrames,
      checkpointedFrames: finalCheckpoint.checkpointedFrames
    });

    for (var round = 0; round < FAIRNESS_ROUNDS; round += 1) {
      var active = round % 2 === 0 ? writer : contender;
      active.exec('BEGIN IMMEDIATE');
      active.run('INSERT INTO contention(owner, sequence_no) VALUES(?, ?)', [round % 2 === 0 ? 'writer' : 'contender', round + 10]);
      active.exec('COMMIT');
    }

    var totals = writer.query('SELECT owner, COUNT(*) AS count FROM contention GROUP BY owner ORDER BY owner').rows;
    assert.strictEqual(totals.length, 2);
    assert.ok(totals.every(function (entry) { return entry.count >= 10; }), 'both WAL writers must make repeated forward progress');
    evidence.fairness = Object.freeze({ rounds: FAIRNESS_ROUNDS, totals: totals });
    evidence.finalRows = writer.query('SELECT COUNT(*) AS count FROM contention').rows[0].count;
    return Object.freeze(evidence);
  } finally {
    try { contender.close(); } finally { writer.close(); }
  }
}

function qualifyRollbackJournal(filename) {
  seed(filename, 'delete');
  var pair = openPair(filename, 'delete');
  var writer = pair.first;
  var reader = pair.second;
  var evidence = { mode: 'delete' };

  try {
    assert.strictEqual(String(writer.storageState().journalMode).toLowerCase(), 'delete');
    assert.strictEqual(String(reader.storageState().journalMode).toLowerCase(), 'delete');

    writer.exec('BEGIN IMMEDIATE');
    writer.run('INSERT INTO contention(owner, sequence_no) VALUES(?, ?)', ['writer', 1]);
    assert.strictEqual(reader.query('SELECT COUNT(*) AS count FROM contention').rows[0].count, 0);
    evidence.writerContention = assertBusy(function () {
      reader.run('INSERT INTO contention(owner, sequence_no) VALUES(?, ?)', ['reader', 1]);
    }, 'rollback-journal competing writer');
    writer.exec('COMMIT');

    reader.exec('BEGIN');
    assert.strictEqual(reader.query('SELECT COUNT(*) AS count FROM contention').rows[0].count, 1);
    writer.exec('BEGIN IMMEDIATE');
    writer.run('INSERT INTO contention(owner, sequence_no) VALUES(?, ?)', ['writer', 2]);

    evidence.readerBlocksCommit = assertBusy(function () {
      writer.exec('COMMIT');
    }, 'rollback-journal commit behind active reader');

    reader.exec('COMMIT');
    writer.exec('COMMIT');
    assert.strictEqual(writer.query('SELECT COUNT(*) AS count FROM contention').rows[0].count, 2);

    for (var round = 0; round < FAIRNESS_ROUNDS; round += 1) {
      var active = round % 2 === 0 ? writer : reader;
      active.exec('BEGIN IMMEDIATE');
      active.run('INSERT INTO contention(owner, sequence_no) VALUES(?, ?)', [round % 2 === 0 ? 'writer' : 'reader', round + 10]);
      active.exec('COMMIT');
    }

    var totals = writer.query('SELECT owner, COUNT(*) AS count FROM contention GROUP BY owner ORDER BY owner').rows;
    assert.strictEqual(totals.length, 2);
    assert.ok(totals.every(function (entry) { return entry.count >= 10; }), 'both rollback-journal writers must make repeated forward progress');
    evidence.fairness = Object.freeze({ rounds: FAIRNESS_ROUNDS, totals: totals });
    evidence.finalRows = writer.query('SELECT COUNT(*) AS count FROM contention').rows[0].count;
    return Object.freeze(evidence);
  } finally {
    try { reader.close(); } finally { writer.close(); }
  }
}

function run() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'nublox-sqlite-concurrency-'));
  try {
    var wal = qualifyWal(path.join(root, 'wal.sqlite'));
    var rollback = qualifyRollbackJournal(path.join(root, 'rollback.sqlite'));
    console.log('NUBLOX_SQLITE_PRODUCTION_CONCURRENCY ' + JSON.stringify({
      node: process.version,
      busyTimeoutMilliseconds: BUSY_TIMEOUT_MS,
      fairnessRounds: FAIRNESS_ROUNDS,
      wal: wal,
      rollbackJournal: rollback
    }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run();
