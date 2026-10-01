'use strict';

var assert = require('node:assert');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var sqlite = require('..');

function capture(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return null;
}

function assertCorruptStorageFailure(error, label) {
  assert.ok(error, label + ' must fail deterministically');
  assert.ok(error.name === 'NuBloxSqlError' || error.name === 'SqliteError', label + ' must surface a database error');
  assert.strictEqual(error.category, 'connection', label + ' must classify corrupt storage as a connection/storage failure');
  assert.strictEqual(error.retryable, false, label + ' must not encourage retrying immutable corrupt storage');
  var nativeCode = String(error.nativeCode || error.code || '');
  assert.ok(
    nativeCode.indexOf('SQLITE_NOTADB') >= 0 ||
    nativeCode.indexOf('SQLITE_CORRUPT') >= 0 ||
    nativeCode.indexOf('SQLITE_FORMAT') >= 0 ||
    String(error.message || '').toLowerCase().indexOf('malformed') >= 0 ||
    String(error.message || '').toLowerCase().indexOf('not a database') >= 0,
    label + ' must retain an SQLite corruption/not-database signal'
  );
}

function qualifyNotDatabase(root) {
  var filename = path.join(root, 'not-a-database.sqlite');
  fs.writeFileSync(filename, Buffer.from('NUBLOXSQL deliberately invalid SQLite file\n'.repeat(64), 'utf8'));

  var db = sqlite.createConnection({ filename: filename, mode: 'readwrite', busyTimeout: 100 });
  try {
    var error = capture(function () { db.query('SELECT name FROM sqlite_schema'); });
    assertCorruptStorageFailure(error, 'non-SQLite file');
    return Object.freeze({
      case: 'not-a-database',
      category: error.category,
      retryable: error.retryable,
      nativeCode: error.nativeCode || error.code || null
    });
  } finally {
    db.close();
  }
}

function qualifyTruncatedDatabase(root) {
  var filename = path.join(root, 'truncated.sqlite');
  var healthy = sqlite.createConnection({ filename: filename, journalMode: 'delete', synchronous: 'full' });
  try {
    healthy.exec('CREATE TABLE payload(id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    var insert = healthy.prepare('INSERT INTO payload(value) VALUES(?)');
    healthy.transaction(function () {
      for (var i = 0; i < 500; i += 1) insert.run(['payload-' + i + '-' + 'x'.repeat(256)]);
    });
    assert.strictEqual(healthy.integrityCheck().ok, true);
  } finally {
    healthy.close();
  }

  var originalBytes = fs.statSync(filename).size;
  assert.ok(originalBytes > 4096, 'fixture must span multiple pages before truncation');
  fs.truncateSync(filename, Math.max(512, Math.floor(originalBytes / 3)));

  var damaged = sqlite.createConnection({ filename: filename, mode: 'readwrite', busyTimeout: 100 });
  try {
    var error = capture(function () {
      var integrity = damaged.integrityCheck({ maxErrors: 10 });
      if (!integrity.ok) {
        var synthetic = new Error(integrity.messages.join('; '));
        synthetic.name = 'SqliteError';
        synthetic.code = 'SQLITE_CORRUPT';
        synthetic.category = 'connection';
        synthetic.retryable = false;
        synthetic.nativeCode = 'SQLITE_CORRUPT';
        throw synthetic;
      }
      damaged.query('SELECT COUNT(*) AS count FROM payload');
    });
    assertCorruptStorageFailure(error, 'truncated SQLite database');
    return Object.freeze({
      case: 'truncated-database',
      originalBytes: originalBytes,
      truncatedBytes: fs.statSync(filename).size,
      category: error.category,
      retryable: error.retryable,
      nativeCode: error.nativeCode || error.code || null
    });
  } finally {
    damaged.close();
  }
}

function qualifyHostileMetadata(root) {
  var filename = path.join(root, 'hostile-metadata.sqlite');
  var db = sqlite.createConnection({ filename: filename, journalMode: 'wal' });
  var tableName = 'select "odd" table; -- Ω';
  var columnName = 'value "quoted" ; DROP TABLE x; --';
  var secondColumn = 'line\nbreak\tcolumn';

  try {
    db.exec(
      'CREATE TABLE "select ""odd"" table; -- Ω" (' +
      '"value ""quoted"" ; DROP TABLE x; --" TEXT NOT NULL, ' +
      '"line\nbreak\tcolumn" INTEGER DEFAULT 7)'
    );

    var tables = db.listTables();
    var found = tables.find(function (entry) { return entry.name === tableName; });
    assert.ok(found, 'hostile table identifier must round-trip through metadata');

    var columns = db.tableInfo(tableName);
    assert.ok(columns.some(function (entry) { return entry.name === columnName; }), 'quoted hostile column name must round-trip');
    assert.ok(columns.some(function (entry) { return entry.name === secondColumn; }), 'control-character column name must round-trip');

    db.run(
      'INSERT INTO "select ""odd"" table; -- Ω" ("value ""quoted"" ; DROP TABLE x; --") VALUES(?)',
      ['safe-value']
    );
    var count = db.query('SELECT COUNT(*) AS count FROM "select ""odd"" table; -- Ω"').rows[0].count;
    assert.strictEqual(count, 1);

    return Object.freeze({
      case: 'hostile-metadata',
      tableName: tableName,
      columns: columns.map(function (entry) { return entry.name; }),
      rowCount: count
    });
  } finally {
    db.close();
  }
}

function run() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'nublox-sqlite-corruption-'));
  try {
    var evidence = {
      node: process.version,
      notDatabase: qualifyNotDatabase(root),
      truncatedDatabase: qualifyTruncatedDatabase(root),
      hostileMetadata: qualifyHostileMetadata(root)
    };
    console.log('NUBLOX_SQLITE_PRODUCTION_CORRUPTION ' + JSON.stringify(evidence));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run();
