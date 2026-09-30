'use strict';

var sqliteModule = require('node:sqlite');

var CONFLICT_NAMES = Object.freeze({
  SQLITE_CHANGESET_DATA: 'data',
  SQLITE_CHANGESET_NOTFOUND: 'notfound',
  SQLITE_CHANGESET_CONFLICT: 'conflict',
  SQLITE_CHANGESET_CONSTRAINT: 'constraint',
  SQLITE_CHANGESET_FOREIGN_KEY: 'foreign-key'
});

var RESOLUTION_NAMES = Object.freeze({
  abort: 'SQLITE_CHANGESET_ABORT',
  omit: 'SQLITE_CHANGESET_OMIT',
  replace: 'SQLITE_CHANGESET_REPLACE'
});

function simpleDatabaseName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new TypeError('SQLite changeset database name must be a simple SQL identifier');
  return value;
}

function nonEmptyTableName(value) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError('SQLite changeset table name must be a non-empty string');
  return value;
}

function copyBytes(value, label) {
  if (!(value instanceof Uint8Array)) throw new TypeError(label + ' must be a Uint8Array');
  return new Uint8Array(value);
}

function conflictConstants() {
  var native = sqliteModule.constants || {};
  var out = {};
  Object.keys(CONFLICT_NAMES).concat(Object.keys(RESOLUTION_NAMES).map(function (key) { return RESOLUTION_NAMES[key]; })).forEach(function (key) {
    if (typeof native[key] === 'number') out[key] = native[key];
  });
  return Object.freeze(out);
}

function conflictName(code) {
  var native = sqliteModule.constants || {};
  var name = 'unknown';
  Object.keys(CONFLICT_NAMES).some(function (key) {
    if (native[key] === code) { name = CONFLICT_NAMES[key]; return true; }
    return false;
  });
  return name;
}

function normalizeResolution(value) {
  var native = sqliteModule.constants || {};
  if (typeof value === 'string') {
    var key = RESOLUTION_NAMES[value.toLowerCase()];
    if (!key || typeof native[key] !== 'number') throw new TypeError('SQLite changeset conflict resolution must be abort, omit or replace');
    return native[key];
  }
  if ([native.SQLITE_CHANGESET_ABORT, native.SQLITE_CHANGESET_OMIT, native.SQLITE_CHANGESET_REPLACE].indexOf(value) !== -1) return value;
  throw new TypeError('SQLite changeset conflict resolution must be abort, omit, replace or a valid SQLite changeset resolution constant');
}

function resolutionName(code) {
  var native = sqliteModule.constants || {};
  if (code === native.SQLITE_CHANGESET_ABORT) return 'abort';
  if (code === native.SQLITE_CHANGESET_OMIT) return 'omit';
  if (code === native.SQLITE_CHANGESET_REPLACE) return 'replace';
  return 'unknown';
}

function ChangeSession(nativeSession, runtime, options) {
  this._session = nativeSession;
  this._runtime = runtime;
  this.database = options.database;
  this.table = options.table || null;
  this.closed = false;
}

ChangeSession.prototype._assertOpen = function _assertOpen() {
  if (this.closed) throw new this._runtime.SqliteError('SQLite change session is closed', { category: 'state' });
};

ChangeSession.prototype.changeset = function changeset() {
  this._assertOpen();
  try { return copyBytes(this._session.changeset(), 'SQLite changeset'); }
  catch (error) { throw this._runtime.wrapError(error); }
};

ChangeSession.prototype.patchset = function patchset() {
  this._assertOpen();
  try { return copyBytes(this._session.patchset(), 'SQLite patchset'); }
  catch (error) { throw this._runtime.wrapError(error); }
};

ChangeSession.prototype.close = function close() {
  if (this.closed) return;
  try { this._session.close(); this.closed = true; }
  catch (error) { throw this._runtime.wrapError(error); }
};

function install(runtime) {
  if (!runtime || !runtime.Connection) throw new TypeError('SQLite changeset integration requires runtime Connection');
  var proto = runtime.Connection.prototype;
  if (proto.__nubloxChangesetInstalled) return;
  Object.defineProperty(proto, '__nubloxChangesetInstalled', { value: true, enumerable: false });

  proto.changesetCapabilities = function changesetCapabilities() {
    this._assertOpen();
    return Object.freeze({
      sessions: typeof this._database.createSession === 'function',
      changesets: typeof this._database.createSession === 'function',
      patchsets: typeof this._database.createSession === 'function',
      applyChangeset: typeof this._database.applyChangeset === 'function',
      conflictConstants: Object.keys(conflictConstants()).length > 0
    });
  };

  proto.changesetConstants = function changesetConstants() { return conflictConstants(); };

  proto.createChangeSession = function createChangeSession(options) {
    this._assertOpen();
    if (typeof this._database.createSession !== 'function') throw runtime.unsupported('SQLite sessions and changesets');
    options = options || {};
    if (typeof options !== 'object') throw new TypeError('SQLite createChangeSession options must be an object');
    var database = simpleDatabaseName(options.database || options.db || 'main');
    var nativeOptions = { db: database };
    if (options.table !== undefined) nativeOptions.table = nonEmptyTableName(options.table);
    try {
      var session = this._database.createSession(nativeOptions);
      return new ChangeSession(session, runtime, { database: database, table: nativeOptions.table });
    } catch (error) { throw runtime.wrapError(error); }
  };

  proto.applyChangeset = function applyChangeset(bytes, options) {
    this._assertOpen();
    if (typeof this._database.applyChangeset !== 'function') throw runtime.unsupported('SQLite applyChangeset');
    bytes = copyBytes(bytes, 'SQLite changeset');
    options = options || {};
    if (typeof options !== 'object') throw new TypeError('SQLite applyChangeset options must be an object');
    if (options.filter !== undefined && typeof options.filter !== 'function') throw new TypeError('SQLite changeset filter must be a function');
    if (options.onConflict !== undefined && typeof options.onConflict !== 'function') throw new TypeError('SQLite changeset onConflict must be a function');

    var conflicts = [];
    var filteredTables = [];
    var nativeOptions = {};
    if (options.filter) {
      nativeOptions.filter = function filter(table) {
        var accepted = options.filter(table) !== false;
        if (!accepted) filteredTables.push(table);
        return accepted;
      };
    }
    nativeOptions.onConflict = function onConflict(code) {
      var info = Object.freeze({ code: code, name: conflictName(code) });
      var requested = options.onConflict ? options.onConflict(info) : 'abort';
      var resolution = normalizeResolution(requested);
      conflicts.push(Object.freeze({ code: code, name: info.name, resolution: resolutionName(resolution) }));
      return resolution;
    };

    try {
      var applied = this._database.applyChangeset(bytes, nativeOptions);
      return Object.freeze({
        applied: applied === true,
        conflicts: Object.freeze(conflicts.slice()),
        filteredTables: Object.freeze(filteredTables.slice())
      });
    } catch (error) { throw runtime.wrapError(error); }
  };
}

exports.ChangeSession = ChangeSession;
exports.install = install;
