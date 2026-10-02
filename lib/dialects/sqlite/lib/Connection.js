'use strict';

var fs = require('fs');
var path = require('path');
var sqliteModule = require('node:sqlite');
var DatabaseSync = sqliteModule.DatabaseSync;
var storagePolicy = require('./StoragePolicy');

function byteSize(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'string') return Buffer.byteLength(value);
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return 8;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (typeof value === 'object') {
    var total = 0;
    Object.keys(value).forEach(function addKey(key) { total += Buffer.byteLength(key) + byteSize(value[key]); });
    return total;
  }
  return Buffer.byteLength(String(value));
}

function classifyError(error) {
  var code = error && error.code;
  var errcode = error && error.errcode;
  var primary = Number.isInteger(errcode) ? (errcode & 255) : undefined;
  if (primary === 19) return { category: 'constraint', retryable: false };
  if (primary === 5 || primary === 6) return { category: 'timeout', retryable: true };
  if (primary === 10 || primary === 11 || primary === 14 || primary === 24 || primary === 26) return { category: 'connection', retryable: false };
  if (primary === 21) return { category: 'state', retryable: false };
  if (primary === 1) return { category: 'syntax', retryable: false };
  if (typeof code === 'string' && code.indexOf('SQLITE_CONSTRAINT') >= 0) return { category: 'constraint', retryable: false };
  if (typeof code === 'string' && (code.indexOf('SQLITE_BUSY') >= 0 || code.indexOf('SQLITE_LOCKED') >= 0)) return { category: 'timeout', retryable: true };
  if (typeof code === 'string' && (
    code.indexOf('SQLITE_CANTOPEN') >= 0 ||
    code.indexOf('SQLITE_IOERR') >= 0 ||
    code.indexOf('SQLITE_CORRUPT') >= 0 ||
    code.indexOf('SQLITE_FORMAT') >= 0 ||
    code.indexOf('SQLITE_NOTADB') >= 0
  )) return { category: 'connection', retryable: false };
  return { category: 'unknown', retryable: false };
}

function SqliteError(message, details) {
  Error.call(this, message);
  this.name = 'SqliteError';
  this.message = message;
  if (Error.captureStackTrace) Error.captureStackTrace(this, SqliteError);
  details = details || {};
  this.code = details.code;
  this.sqliteCode = details.sqliteCode;
  this.category = details.category || 'unknown';
  this.retryable = details.retryable === true;
  this.cause = details.cause;
}
SqliteError.prototype = Object.create(Error.prototype);
SqliteError.prototype.constructor = SqliteError;

function SqliteResultLimitError(message, details) {
  SqliteError.call(this, message, details);
  this.name = 'SqliteResultLimitError';
  this.category = 'resource-limit';
  this.limit = details && details.limit;
  this.observed = details && details.observed;
}
SqliteResultLimitError.prototype = Object.create(SqliteError.prototype);
SqliteResultLimitError.prototype.constructor = SqliteResultLimitError;

function unsupported(feature) {
  return new SqliteError('SQLite runtime does not support ' + feature + ' on this Node.js version', { code: 'NUBLOXSQL_UNSUPPORTED', category: 'unsupported' });
}

function wrapError(error) {
  if (error instanceof SqliteError) return error;
  var classified = classifyError(error);
  return new SqliteError(error && error.message ? error.message : 'SQLite operation failed', {
    code: error && error.code,
    sqliteCode: error && error.errcode,
    category: classified.category,
    retryable: classified.retryable,
    cause: error
  });
}

function invoke(statement, method, parameters) {
  if (parameters === undefined) return statement[method]();
  if (Array.isArray(parameters)) return statement[method].apply(statement, parameters);
  if (parameters && typeof parameters === 'object' && !ArrayBuffer.isView(parameters) && !(parameters instanceof ArrayBuffer)) return statement[method](parameters);
  return statement[method](parameters);
}

function PreparedStatement(statement, options) {
  this._statement = statement;
  this._options = options || {};
  if (typeof statement.setReadBigInts === 'function' && this._options.readBigInts === true) statement.setReadBigInts(true);
}
PreparedStatement.prototype.columns = function columns() {
  try { return this._statement.columns().map(function (column) { return Object.freeze({ name: column.name, nativeType: column.type || undefined, extension: Object.freeze({ database: column.database, table: column.table, column: column.column }) }); }); }
  catch (error) { throw wrapError(error); }
};
PreparedStatement.prototype.get = function get(parameters) { try { var row = invoke(this._statement, 'get', parameters); return row === undefined ? undefined : Object.assign({}, row); } catch (error) { throw wrapError(error); } };
PreparedStatement.prototype.run = function run(parameters) { try { var result = invoke(this._statement, 'run', parameters); return Object.freeze({ kind: 'command', affectedRows: result.changes, rowCount: Number(result.changes), insertId: result.lastInsertRowid, extension: result }); } catch (error) { throw wrapError(error); } };
PreparedStatement.prototype.iterate = function iterate(parameters) { var statement = this._statement; return (function* () { try { var iterator = invoke(statement, 'iterate', parameters); for (var row of iterator) yield Object.assign({}, row); } catch (error) { throw wrapError(error); } }()); };
PreparedStatement.prototype.all = function all(parameters, options) {
  options = options || {};
  try {
    var iterator = invoke(this._statement, 'iterate', parameters), rows = [], totalBytes = 0;
    for (var nativeRow of iterator) {
      var row = Object.assign({}, nativeRow), rowBytes = byteSize(row);
      if (Number.isInteger(options.maxRowBytes) && options.maxRowBytes >= 0 && rowBytes > options.maxRowBytes) throw new SqliteResultLimitError('SQLite row byte limit exceeded', { limit: options.maxRowBytes, observed: rowBytes });
      totalBytes += rowBytes;
      if (Number.isInteger(options.maxResultBytes) && options.maxResultBytes >= 0 && totalBytes > options.maxResultBytes) throw new SqliteResultLimitError('SQLite result byte limit exceeded', { limit: options.maxResultBytes, observed: totalBytes });
      rows.push(row);
      if (Number.isInteger(options.maxRows) && options.maxRows >= 0 && rows.length > options.maxRows) throw new SqliteResultLimitError('SQLite row limit exceeded', { limit: options.maxRows, observed: rows.length });
    }
    return Object.freeze({ kind: 'rows', rows: Object.freeze(rows), fields: Object.freeze(this.columns()), rowCount: rows.length, extension: Object.freeze({ resultBytes: totalBytes }) });
  } catch (error) { throw wrapError(error); }
};

function quoteIdentifier(identifier) { return '"' + String(identifier).replace(/"/g, '""') + '"'; }
function quoteLiteral(value) { return "'" + String(value).replace(/'/g, "''") + "'"; }
function validateDatabaseName(name) { if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new TypeError('SQLite database name must be a simple SQL identifier'); return name; }
function extensionPolicy(config) {
  var enabled = config.allowExtension === true;
  var allowlist = config.extensionAllowlist;
  if (allowlist === undefined) allowlist = [];
  if (!Array.isArray(allowlist) || allowlist.some(function (entry) { return typeof entry !== 'string' || entry.length === 0; })) throw new TypeError('SQLite extensionAllowlist must be an array of non-empty paths');
  if (!enabled && allowlist.length) throw new TypeError('SQLite extensionAllowlist requires allowExtension: true');
  return Object.freeze({ enabled: enabled, allowlist: Object.freeze(allowlist.map(function (entry) { return path.resolve(entry); })) });
}

function Connection(config) {
  config = config || {};
  var filename = config.filename === undefined ? ':memory:' : config.filename;
  if (!(typeof filename === 'string' || Buffer.isBuffer(filename) || filename instanceof URL)) throw new TypeError('SQLite filename must be a string, Buffer or URL');
  var mode = config.mode || (config.readOnly === true ? 'readonly' : 'readwrite-create');
  if (['readonly', 'readwrite', 'readwrite-create'].indexOf(mode) === -1) throw new RangeError('SQLite mode must be readonly, readwrite or readwrite-create');
  if (mode === 'readwrite' && filename !== ':memory:' && !fs.existsSync(filename)) throw new SqliteError('SQLite readwrite mode requires an existing database', { category: 'connection' });
  this.filename = filename;
  this.mode = mode;
  this.readBigInts = config.readBigInts === true;
  this.closed = config.open === false;
  this._queryOnly = config.queryOnly === true;
  this._storagePolicy = storagePolicy.effectiveOptions(config);
  this._extensionPolicy = extensionPolicy(config);
  this._openOptions = {
    open: config.open !== false,
    readOnly: mode === 'readonly',
    allowExtension: this._extensionPolicy.enabled
  };
  this._database = null;
  if (!this.closed) this.open();
}

Connection.prototype._assertOpen = function _assertOpen() { if (this.closed || !this._database) throw new SqliteError('SQLite connection is closed', { category: 'state' }); };
Connection.prototype.open = function open() {
  if (!this.closed && this._database) return this;
  try {
    this._database = new DatabaseSync(this.filename, this._openOptions);
    this.closed = false;
    storagePolicy.apply(this._database, this._storagePolicy);
    if (this._queryOnly) this._database.exec('PRAGMA query_only = ON');
    return this;
  } catch (error) {
    this._database = null;
    this.closed = true;
    throw wrapError(error);
  }
};
Connection.prototype.close = function close() { if (this._database) this._database.close(); this._database = null; this.closed = true; };
Connection.prototype.exec = function exec(sql) { this._assertOpen(); try { this._database.exec(String(sql)); return Object.freeze({ kind: 'command' }); } catch (error) { throw wrapError(error); } };
Connection.prototype.prepare = function prepare(sql, options) { this._assertOpen(); try { return new PreparedStatement(this._database.prepare(String(sql)), Object.assign({ readBigInts: this.readBigInts }, options || {})); } catch (error) { throw wrapError(error); } };
Connection.prototype.query = function query(sql, parameters, options) { return this.prepare(sql, options).all(parameters, options); };
Connection.prototype.run = function run(sql, parameters, options) { return this.prepare(sql, options).run(parameters); };
Connection.prototype.begin = function begin(mode) { mode = mode || 'deferred'; if (['deferred', 'immediate', 'exclusive'].indexOf(mode) === -1) throw new RangeError('SQLite transaction mode must be deferred, immediate or exclusive'); return this.exec('BEGIN ' + mode.toUpperCase()); };
Connection.prototype.commit = function commit() { return this.exec('COMMIT'); };
Connection.prototype.rollback = function rollback() { return this.exec('ROLLBACK'); };
Connection.prototype.savepoint = function savepoint(name) { return this.exec('SAVEPOINT ' + quoteIdentifier(name)); };
Connection.prototype.release = function release(name) { return this.exec('RELEASE SAVEPOINT ' + quoteIdentifier(name)); };
Connection.prototype.rollbackTo = function rollbackTo(name) { return this.exec('ROLLBACK TO SAVEPOINT ' + quoteIdentifier(name)); };
Connection.prototype.transaction = function transaction(fn, mode) { this.begin(mode); try { var value = fn(this); this.commit(); return value; } catch (error) { try { this.rollback(); } catch (_) {} throw error; } };
Connection.prototype.databaseList = function databaseList() { this._assertOpen(); return this.query('PRAGMA database_list').rows.map(function (row) { return Object.freeze({ sequence: row.seq, name: row.name, file: row.file || null }); }); };
Connection.prototype.listTables = function listTables(database) { database = validateDatabaseName(database || 'main'); return this.query("SELECT name, type, tbl_name AS tableName, rootpage, sql FROM " + quoteIdentifier(database) + ".sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name").rows.map(function (row) { return Object.freeze(row); }); };
Connection.prototype.tableInfo = function tableInfo(name, database) { database = validateDatabaseName(database || 'main'); return this.query('PRAGMA ' + quoteIdentifier(database) + '.table_xinfo(' + quoteLiteral(name) + ')').rows.map(function (row) { return Object.freeze(row); }); };
Connection.prototype.attach = function attach(filename, name) { name = validateDatabaseName(name); var raw = filename instanceof URL ? filename.pathname : filename; if (typeof raw !== 'string') throw new TypeError('SQLite attach filename must be a string or URL'); this.exec('ATTACH DATABASE ' + quoteLiteral(raw) + ' AS ' + quoteIdentifier(name)); return Object.freeze({ name: name, file: raw }); };
Connection.prototype.detach = function detach(name) { name = validateDatabaseName(name); return this.exec('DETACH DATABASE ' + quoteIdentifier(name)); };
Connection.prototype.backup = function backup(destination, options) { this._assertOpen(); if (typeof sqliteModule.backup !== 'function') return Promise.reject(unsupported('backup')); options = options || {}; var backupOptions = {}; if (options.source !== undefined) backupOptions.source = validateDatabaseName(options.source); if (options.target !== undefined) backupOptions.target = validateDatabaseName(options.target); if (options.rate !== undefined) backupOptions.rate = options.rate; if (options.progress !== undefined) backupOptions.progress = options.progress; return sqliteModule.backup(this._database, destination, backupOptions).catch(function (error) { throw wrapError(error); }); };
Connection.prototype.serialize = function serialize(database) { this._assertOpen(); if (typeof this._database.serialize !== 'function') throw unsupported('serialize'); try { return this._database.serialize(validateDatabaseName(database || 'main')); } catch (error) { throw wrapError(error); } };
Connection.prototype.deserialize = function deserialize(buffer, options) { this._assertOpen(); if (typeof this._database.deserialize !== 'function') throw unsupported('deserialize'); if (!(buffer instanceof Uint8Array)) throw new TypeError('SQLite deserialize requires a Uint8Array'); options = options || {}; var database = validateDatabaseName(options.database || options.dbName || 'main'); try { this._database.deserialize(buffer, { database: database }); return this; } catch (error) { throw wrapError(error); } };
Connection.prototype.lifecycleCapabilities = function lifecycleCapabilities() { return Object.freeze({ backup: typeof sqliteModule.backup === 'function', serialize: !!(this._database && typeof this._database.serialize === 'function'), deserialize: !!(this._database && typeof this._database.deserialize === 'function'), attach: true, detach: true, explicitOpen: true }); };

module.exports = {
  Connection: Connection,
  PreparedStatement: PreparedStatement,
  SqliteError: SqliteError,
  SqliteResultLimitError: SqliteResultLimitError
};
