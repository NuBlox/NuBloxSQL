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
  if (primary === 14 || primary === 10 || primary === 26) return { category: 'connection', retryable: false };
  if (primary === 21) return { category: 'state', retryable: false };
  if (primary === 1) return { category: 'syntax', retryable: false };
  if (typeof code === 'string' && code.indexOf('SQLITE_CONSTRAINT') >= 0) return { category: 'constraint', retryable: false };
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
    timeout: this._storagePolicy.busyTimeout,
    enableForeignKeyConstraints: config.foreignKeys !== false,
    readBigInts: this.readBigInts,
    allowExtension: this._extensionPolicy.enabled
  };
  try {
    this._database = new DatabaseSync(filename, this._openOptions);
    if (config.open !== false) {
      storagePolicy.apply(this._database, this._storagePolicy);
      if (this._queryOnly) this._database.exec('PRAGMA query_only = ON');
    }
  } catch (error) { throw wrapError(error); }
}
Connection.prototype._assertOpen = function () { if (this.closed || (typeof this._database.isOpen === 'boolean' && !this._database.isOpen)) throw new SqliteError('SQLite connection is closed', { category: 'state' }); };
Connection.prototype.open = function () { if (!this.closed) return; try { this._database.open(); this.closed = false; storagePolicy.apply(this._database, this._storagePolicy); if (this._queryOnly) this._database.exec('PRAGMA query_only = ON'); } catch (error) { throw wrapError(error); } };
Connection.prototype.close = function () { if (this.closed) return; try { this._database.close(); this.closed = true; } catch (error) { throw wrapError(error); } };
Connection.prototype.exec = function (sql) { this._assertOpen(); if (typeof sql !== 'string' || sql.trim().length === 0) throw new TypeError('SQLite SQL must be a non-empty string'); try { this._database.exec(sql); return Object.freeze({ kind: 'command' }); } catch (error) { throw wrapError(error); } };
Connection.prototype.prepare = function (sql, options) { this._assertOpen(); if (typeof sql !== 'string' || sql.trim().length === 0) throw new TypeError('SQLite SQL must be a non-empty string'); try { return new PreparedStatement(this._database.prepare(sql), { readBigInts: options && options.readBigInts !== undefined ? options.readBigInts : this.readBigInts }); } catch (error) { throw wrapError(error); } };
Connection.prototype.query = function (sql, parameters, options) { return this.prepare(sql, options).all(parameters, options); };
Connection.prototype.run = function (sql, parameters, options) { return this.prepare(sql, options).run(parameters); };
Connection.prototype.begin = function (mode) { this._assertOpen(); mode = mode === undefined ? 'deferred' : String(mode).toLowerCase(); if (['deferred','immediate','exclusive'].indexOf(mode) === -1) throw new RangeError('SQLite transaction mode must be deferred, immediate or exclusive'); return this.exec('BEGIN ' + mode.toUpperCase()); };
Connection.prototype.commit = function () { return this.exec('COMMIT'); };
Connection.prototype.rollback = function () { return this.exec('ROLLBACK'); };
Connection.prototype.savepoint = function (name) { return this.exec('SAVEPOINT ' + quoteIdentifier(name)); };
Connection.prototype.release = function (name) { return this.exec('RELEASE SAVEPOINT ' + quoteIdentifier(name)); };
Connection.prototype.rollbackTo = function (name) { return this.exec('ROLLBACK TO SAVEPOINT ' + quoteIdentifier(name)); };
Connection.prototype.transaction = function (fn, options) { if (typeof fn !== 'function') throw new TypeError('SQLite transaction requires a function'); this.begin(options && options.mode); try { var value = fn(this); if (value && typeof value.then === 'function') throw new TypeError('SQLite synchronous transaction callback must not return a Promise'); this.commit(); return value; } catch (error) { try { if (this._database.isTransaction) this.rollback(); } catch (_) {} throw error; } };
Connection.prototype.isTransaction = function () { this._assertOpen(); return this._database.isTransaction === true; };
Connection.prototype.listDatabases = function () { return this.query('PRAGMA database_list').rows.map(function (row) { return Object.freeze({ sequence: row.seq, name: row.name, file: row.file || null }); }); };
Connection.prototype.listTables = function (database) { database = validateDatabaseName(database || 'main'); var sql = 'SELECT name, type, tbl_name AS tableName, rootpage, sql FROM ' + quoteIdentifier(database) + ".sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name"; return this.query(sql).rows; };
Connection.prototype.tableInfo = function (name, database) { if (typeof name !== 'string' || name.length === 0) throw new TypeError('SQLite table name must be a non-empty string'); database = validateDatabaseName(database || 'main'); return this.query('PRAGMA ' + quoteIdentifier(database) + '.table_xinfo(' + quoteLiteral(name) + ')').rows; };
Connection.prototype.attach = function (filename, name) { this._assertOpen(); if (!(typeof filename === 'string' || filename instanceof URL)) throw new TypeError('SQLite attached database filename must be a string or URL'); name = validateDatabaseName(name); var filePath = filename instanceof URL ? filename.pathname : filename; this.exec('ATTACH DATABASE ' + quoteLiteral(filePath) + ' AS ' + quoteIdentifier(name)); return Object.freeze({ name: name, file: filePath }); };
Connection.prototype.detach = function (name) { this._assertOpen(); name = validateDatabaseName(name); if (name === 'main' || name === 'temp') throw new SqliteError('SQLite cannot detach the main or temp database', { category: 'state' }); this.exec('DETACH DATABASE ' + quoteIdentifier(name)); };
Connection.prototype.backup = function (destination, options) { this._assertOpen(); if (typeof sqliteModule.backup !== 'function') return Promise.reject(unsupported('backup')); options = options || {}; var backupOptions = {}; if (options.source !== undefined) backupOptions.source = validateDatabaseName(options.source); if (options.target !== undefined) backupOptions.target = validateDatabaseName(options.target); if (options.rate !== undefined) backupOptions.rate = options.rate; if (options.progress !== undefined) backupOptions.progress = options.progress; return sqliteModule.backup(this._database, destination, backupOptions).catch(function (error) { throw wrapError(error); }); };
Connection.prototype.serialize = function (database) { this._assertOpen(); if (typeof this._database.serialize !== 'function') throw unsupported('serialize'); try { return this._database.serialize(validateDatabaseName(database || 'main')); } catch (error) { throw wrapError(error); } };
Connection.prototype.deserialize = function (buffer, options) { this._assertOpen(); if (typeof this._database.deserialize !== 'function') throw unsupported('deserialize'); if (!(buffer instanceof Uint8Array)) throw new TypeError('SQLite deserialize() requires a Uint8Array'); options = options || {}; try { this._database.deserialize(buffer, { dbName: validateDatabaseName(options.database || options.dbName || 'main') }); } catch (error) { throw wrapError(error); } };
Connection.prototype.lifecycleCapabilities = function () { return Object.freeze({ backup: typeof sqliteModule.backup === 'function', serialize: typeof this._database.serialize === 'function', deserialize: typeof this._database.deserialize === 'function', attach: true, detach: true, explicitOpen: typeof this._database.open === 'function' }); };
Connection.prototype.storageState = function (database) { this._assertOpen(); try { return storagePolicy.state(this._database, database || 'main'); } catch (error) { throw wrapError(error); } };
Connection.prototype.checkpoint = function (mode, database) { this._assertOpen(); try { return storagePolicy.checkpoint(this._database, mode || 'passive', database || 'main'); } catch (error) { throw wrapError(error); } };
Connection.prototype.storagePolicy = function () { return this._storagePolicy; };

exports.Connection = Connection;
exports.PreparedStatement = PreparedStatement;
exports.SqliteError = SqliteError;
exports.SqliteResultLimitError = SqliteResultLimitError;
exports.unsupported = unsupported;
exports.wrapError = wrapError;