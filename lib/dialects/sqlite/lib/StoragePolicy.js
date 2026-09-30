'use strict';

var JOURNAL_MODES = Object.freeze(['delete','truncate','persist','memory','wal','off']);
var SYNCHRONOUS = Object.freeze(['off','normal','full','extra']);
var LOCKING_MODES = Object.freeze(['normal','exclusive']);
var CHECKPOINT_MODES = Object.freeze(['passive','full','restart','truncate']);

function enumValue(name, value, allowed) {
  value = String(value).toLowerCase();
  if (allowed.indexOf(value) === -1) throw new RangeError('SQLite ' + name + ' must be one of: ' + allowed.join(', '));
  return value;
}

function nonNegativeInteger(name, value) {
  if (!Number.isInteger(value) || value < 0) throw new RangeError('SQLite ' + name + ' must be a non-negative integer');
  return value;
}

function databaseName(value) {
  value = value || 'main';
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new TypeError('SQLite database name must be a simple SQL identifier');
  return value;
}

function quoteIdentifier(value) { return '"' + String(value).replace(/"/g, '""') + '"'; }
function scalar(db, sql) { var row = db.prepare(sql).get(); return row && row[Object.keys(row)[0]]; }

function effectiveOptions(config) {
  config = config || {};
  var production = config.productionDefaults === true;
  return Object.freeze({
    journalMode: config.journalMode === undefined ? (production ? 'wal' : undefined) : enumValue('journalMode', config.journalMode, JOURNAL_MODES),
    synchronous: config.synchronous === undefined ? (production ? 'normal' : undefined) : enumValue('synchronous', config.synchronous, SYNCHRONOUS),
    lockingMode: config.lockingMode === undefined ? (production ? 'normal' : undefined) : enumValue('lockingMode', config.lockingMode, LOCKING_MODES),
    busyTimeout: config.busyTimeout === undefined ? 5000 : nonNegativeInteger('busyTimeout', config.busyTimeout),
    walAutoCheckpoint: config.walAutoCheckpoint === undefined ? (production ? 1000 : undefined) : nonNegativeInteger('walAutoCheckpoint', config.walAutoCheckpoint),
    cacheSize: config.cacheSize === undefined ? undefined : (Number.isInteger(config.cacheSize) ? config.cacheSize : (function () { throw new RangeError('SQLite cacheSize must be an integer'); }()))
  });
}

function apply(db, options) {
  if (options.journalMode !== undefined) db.exec('PRAGMA journal_mode = ' + options.journalMode.toUpperCase());
  if (options.synchronous !== undefined) db.exec('PRAGMA synchronous = ' + options.synchronous.toUpperCase());
  if (options.lockingMode !== undefined) db.exec('PRAGMA locking_mode = ' + options.lockingMode.toUpperCase());
  db.exec('PRAGMA busy_timeout = ' + options.busyTimeout);
  if (options.walAutoCheckpoint !== undefined) db.exec('PRAGMA wal_autocheckpoint = ' + options.walAutoCheckpoint);
  if (options.cacheSize !== undefined) db.exec('PRAGMA cache_size = ' + options.cacheSize);
}

function state(db, database) {
  database = databaseName(database);
  var prefix = 'PRAGMA ' + quoteIdentifier(database) + '.';
  return Object.freeze({
    database: database,
    journalMode: String(scalar(db, prefix + 'journal_mode') || '').toLowerCase(),
    synchronous: Number(scalar(db, prefix + 'synchronous')),
    lockingMode: String(scalar(db, prefix + 'locking_mode') || '').toLowerCase(),
    busyTimeout: Number(scalar(db, 'PRAGMA busy_timeout')),
    walAutoCheckpoint: Number(scalar(db, 'PRAGMA wal_autocheckpoint')),
    cacheSize: Number(scalar(db, prefix + 'cache_size')),
    pageSize: Number(scalar(db, prefix + 'page_size')),
    pageCount: Number(scalar(db, prefix + 'page_count')),
    freelistCount: Number(scalar(db, prefix + 'freelist_count'))
  });
}

function checkpoint(db, mode, database) {
  mode = enumValue('checkpoint mode', mode || 'passive', CHECKPOINT_MODES);
  database = databaseName(database);
  var row = db.prepare('PRAGMA ' + quoteIdentifier(database) + '.wal_checkpoint(' + mode.toUpperCase() + ')').get();
  var keys = row ? Object.keys(row) : [];
  return Object.freeze({
    database: database,
    mode: mode,
    busy: Number(row && row[keys[0]] || 0),
    logFrames: Number(row && row[keys[1]] || 0),
    checkpointedFrames: Number(row && row[keys[2]] || 0),
    native: row || null
  });
}

exports.JOURNAL_MODES = JOURNAL_MODES;
exports.SYNCHRONOUS = SYNCHRONOUS;
exports.LOCKING_MODES = LOCKING_MODES;
exports.CHECKPOINT_MODES = CHECKPOINT_MODES;
exports.effectiveOptions = effectiveOptions;
exports.apply = apply;
exports.state = state;
exports.checkpoint = checkpoint;
