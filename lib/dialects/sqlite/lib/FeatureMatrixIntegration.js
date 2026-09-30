'use strict';

function probe(db, fn) {
  try { return fn() === false ? false : true; }
  catch (_) { return false; }
}

function scalar(db, sql) {
  var row = db.prepare(sql).get();
  return row && row[Object.keys(row)[0]];
}

function cleanup(db) {
  try { db.exec('DROP TABLE IF EXISTS temp._nublox_feature_probe'); } catch (_) {}
  try { db.exec('DROP TABLE IF EXISTS temp._nublox_feature_strict'); } catch (_) {}
  try { db.exec('DROP TABLE IF EXISTS temp._nublox_feature_fts'); } catch (_) {}
}

function matrix(connection) {
  connection._assertOpen();
  var db = connection._database;
  cleanup(db);
  var sqliteVersion = String(scalar(db, 'SELECT sqlite_version()') || '');
  var compileOptions = [];
  try { compileOptions = db.prepare('PRAGMA compile_options').all().map(function (row) { return String(row[Object.keys(row)[0]]); }); } catch (_) {}

  var features = {
    commonTableExpressions: probe(db, function () { db.prepare('WITH x(v) AS (VALUES(1)) SELECT v FROM x').get(); }),
    windowFunctions: probe(db, function () { db.prepare('SELECT row_number() OVER (ORDER BY column1) AS n FROM (VALUES (2),(1))').all(); }),
    returning: probe(db, function () {
      db.exec('CREATE TEMP TABLE _nublox_feature_probe (id INTEGER PRIMARY KEY, value TEXT UNIQUE)');
      db.prepare("INSERT INTO _nublox_feature_probe(value) VALUES ('a') RETURNING id").get();
    }),
    upsert: probe(db, function () {
      if (!probe(db, function () { db.exec('CREATE TEMP TABLE IF NOT EXISTS _nublox_feature_probe (id INTEGER PRIMARY KEY, value TEXT UNIQUE)'); })) return false;
      db.exec("INSERT INTO _nublox_feature_probe(id,value) VALUES (1,'a') ON CONFLICT(id) DO UPDATE SET value=excluded.value");
    }),
    json: probe(db, function () { return Number(scalar(db, "SELECT json_valid('{\"a\":1}')")) === 1; }),
    jsonb: probe(db, function () { return String(scalar(db, "SELECT typeof(jsonb('{\"a\":1}'))")) === 'blob'; }),
    strictTables: probe(db, function () { db.exec('CREATE TEMP TABLE _nublox_feature_strict (id INTEGER) STRICT'); }),
    fts5: probe(db, function () { db.exec('CREATE VIRTUAL TABLE temp._nublox_feature_fts USING fts5(content)'); }),
    builtInCollations: probe(db, function () { return Number(scalar(db, "SELECT 'A' = 'a' COLLATE NOCASE")) === 1; }),
    customCollations: typeof db.createCollation === 'function'
  };
  cleanup(db);

  return Object.freeze({
    sqliteVersion: sqliteVersion,
    features: Object.freeze(features),
    compileOptions: Object.freeze(compileOptions.slice()),
    valueConventions: Object.freeze({
      null: 'null',
      integer: connection.readBigInts ? 'bigint' : 'number-safe-integer',
      real: 'number',
      text: 'string',
      blob: 'Uint8Array',
      boolean: 'integer-0-or-1-by-convention',
      dateTime: 'ISO-8601-UTC-text-by-convention',
      json: features.jsonb ? 'JSON-text-or-JSONB-blob' : (features.json ? 'JSON-text' : 'text-only')
    })
  });
}

function install(Connection) {
  if (!Connection || !Connection.prototype) throw new TypeError('SQLite feature integration requires Connection');
  if (Connection.prototype.__nubloxFeatureMatrixInstalled) return;
  Object.defineProperty(Connection.prototype, '__nubloxFeatureMatrixInstalled', { value: true, enumerable: false });
  Connection.prototype.featureMatrix = function featureMatrix() { return matrix(this); };
  Connection.prototype.valueConventions = function valueConventions() { return matrix(this).valueConventions; };
}

exports.install = install;
exports.matrix = matrix;
