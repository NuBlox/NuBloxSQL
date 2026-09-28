'use strict';

var DatabaseSync = require('node:sqlite').DatabaseSync;

function byteSize(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'string') return Buffer.byteLength(value);
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return 8;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (typeof value === 'object') {
    var total = 0;
    Object.keys(value).forEach(function addKey(key) {
      total += Buffer.byteLength(key) + byteSize(value[key]);
    });
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
  if (parameters && typeof parameters === 'object' && !ArrayBuffer.isView(parameters) && !(parameters instanceof ArrayBuffer)) {
    return statement[method](parameters);
  }
  return statement[method](parameters);
}

function PreparedStatement(statement, options) {
  this._statement = statement;
  this._options = options || {};
  if (typeof statement.setReadBigInts === 'function' && this._options.readBigInts === true) statement.setReadBigInts(true);
}

PreparedStatement.prototype.columns = function columns() {
  try {
    return this._statement.columns().map(function mapColumn(column) {
      return Object.freeze({
        name: column.name,
        nativeType: column.type || undefined,
        extension: Object.freeze({ database: column.database, table: column.table, column: column.column })
      });
    });
  } catch (error) { throw wrapError(error); }
};

PreparedStatement.prototype.get = function get(parameters) {
  try {
    var row = invoke(this._statement, 'get', parameters);
    return row === undefined ? undefined : Object.assign({}, row);
  } catch (error) { throw wrapError(error); }
};

PreparedStatement.prototype.run = function run(parameters) {
  try {
    var result = invoke(this._statement, 'run', parameters);
    return Object.freeze({
      kind: 'command',
      affectedRows: result.changes,
      rowCount: Number(result.changes),
      insertId: result.lastInsertRowid,
      extension: result
    });
  } catch (error) { throw wrapError(error); }
};

PreparedStatement.prototype.iterate = function iterate(parameters) {
  var statement = this._statement;
  return (function* iterateRows() {
    try {
      var iterator = invoke(statement, 'iterate', parameters);
      for (var row of iterator) yield Object.assign({}, row);
    } catch (error) { throw wrapError(error); }
  }());
};

PreparedStatement.prototype.all = function all(parameters, options) {
  options = options || {};
  try {
    var iterator = invoke(this._statement, 'iterate', parameters);
    var rows = [];
    var totalBytes = 0;
    for (var nativeRow of iterator) {
      var row = Object.assign({}, nativeRow);
      var rowBytes = byteSize(row);
      if (Number.isInteger(options.maxRowBytes) && options.maxRowBytes >= 0 && rowBytes > options.maxRowBytes) {
        throw new SqliteResultLimitError('SQLite row byte limit exceeded', { limit: options.maxRowBytes, observed: rowBytes });
      }
      totalBytes += rowBytes;
      if (Number.isInteger(options.maxResultBytes) && options.maxResultBytes >= 0 && totalBytes > options.maxResultBytes) {
        throw new SqliteResultLimitError('SQLite result byte limit exceeded', { limit: options.maxResultBytes, observed: totalBytes });
      }
      rows.push(row);
      if (Number.isInteger(options.maxRows) && options.maxRows >= 0 && rows.length > options.maxRows) {
        throw new SqliteResultLimitError('SQLite row limit exceeded', { limit: options.maxRows, observed: rows.length });
      }
    }
    return Object.freeze({
      kind: 'rows',
      rows: Object.freeze(rows),
      fields: Object.freeze(this.columns()),
      rowCount: rows.length,
      extension: Object.freeze({ resultBytes: totalBytes })
    });
  } catch (error) { throw wrapError(error); }
};

function quoteIdentifier(identifier) {
  return '"' + String(identifier).replace(/"/g, '""') + '"';
}

function quoteLiteral(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function Connection(config) {
  config = config || {};
  var filename = config.filename === undefined ? ':memory:' : config.filename;
  if (!(typeof filename === 'string' || Buffer.isBuffer(filename) || filename instanceof URL)) {
    throw new TypeError('SQLite filename must be a string, Buffer or URL');
  }

  this.filename = filename;
  this.readBigInts = config.readBigInts === true;
  this.closed = false;

  try {
    this._database = new DatabaseSync(filename, { timeout: config.busyTimeout === undefined ? 5000 : config.busyTimeout });
    if (config.foreignKeys !== false) this._database.exec('PRAGMA foreign_keys = ON');
    if (config.readOnly === true) this._database.exec('PRAGMA query_only = ON');
  } catch (error) {
    throw wrapError(error);
  }
}

Connection.prototype._assertOpen = function _assertOpen() {
  if (this.closed) throw new SqliteError('SQLite connection is closed', { category: 'state' });
};

Connection.prototype.close = function close() {
  if (this.closed) return;
  try { this._database.close(); this.closed = true; } catch (error) { throw wrapError(error); }
};

Connection.prototype.exec = function exec(sql) {
  this._assertOpen();
  if (typeof sql !== 'string' || sql.trim().length === 0) throw new TypeError('SQLite SQL must be a non-empty string');
  try {
    this._database.exec(sql);
    return Object.freeze({ kind: 'command' });
  } catch (error) { throw wrapError(error); }
};

Connection.prototype.prepare = function prepare(sql, options) {
  this._assertOpen();
  if (typeof sql !== 'string' || sql.trim().length === 0) throw new TypeError('SQLite SQL must be a non-empty string');
  try {
    return new PreparedStatement(this._database.prepare(sql), {
      readBigInts: options && options.readBigInts !== undefined ? options.readBigInts : this.readBigInts
    });
  } catch (error) { throw wrapError(error); }
};

Connection.prototype.query = function query(sql, parameters, options) {
  return this.prepare(sql, options).all(parameters, options);
};

Connection.prototype.run = function run(sql, parameters, options) {
  return this.prepare(sql, options).run(parameters);
};

Connection.prototype.begin = function begin(mode) {
  this._assertOpen();
  mode = mode === undefined ? 'deferred' : String(mode).toLowerCase();
  if (mode !== 'deferred' && mode !== 'immediate' && mode !== 'exclusive') throw new RangeError('SQLite transaction mode must be deferred, immediate or exclusive');
  return this.exec('BEGIN ' + mode.toUpperCase());
};

Connection.prototype.commit = function commit() { return this.exec('COMMIT'); };
Connection.prototype.rollback = function rollback() { return this.exec('ROLLBACK'); };
Connection.prototype.savepoint = function savepoint(name) { return this.exec('SAVEPOINT ' + quoteIdentifier(name)); };
Connection.prototype.release = function release(name) { return this.exec('RELEASE SAVEPOINT ' + quoteIdentifier(name)); };
Connection.prototype.rollbackTo = function rollbackTo(name) { return this.exec('ROLLBACK TO SAVEPOINT ' + quoteIdentifier(name)); };

Connection.prototype.transaction = function transaction(fn, options) {
  if (typeof fn !== 'function') throw new TypeError('SQLite transaction requires a function');
  this.begin(options && options.mode);
  try {
    var value = fn(this);
    if (value && typeof value.then === 'function') {
      throw new TypeError('SQLite synchronous transaction callback must not return a Promise');
    }
    this.commit();
    return value;
  } catch (error) {
    try { if (this._database.isTransaction) this.rollback(); } catch (_) {}
    throw error;
  }
};

Connection.prototype.isTransaction = function isTransaction() {
  this._assertOpen();
  return this._database.isTransaction === true;
};

Connection.prototype.listDatabases = function listDatabases() {
  return this.query('PRAGMA database_list').rows.map(function mapDatabase(row) {
    return Object.freeze({ sequence: row.seq, name: row.name, file: row.file || null });
  });
};

Connection.prototype.listTables = function listTables(database) {
  database = database || 'main';
  var sql = 'SELECT name, type, tbl_name AS tableName, rootpage, sql FROM ' + quoteIdentifier(database) + ".sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name";
  return this.query(sql).rows;
};

Connection.prototype.tableInfo = function tableInfo(name, database) {
  if (typeof name !== 'string' || name.length === 0) throw new TypeError('SQLite table name must be a non-empty string');
  database = database || 'main';
  return this.query('PRAGMA ' + quoteIdentifier(database) + '.table_xinfo(' + quoteLiteral(name) + ')').rows;
};

exports.Connection = Connection;
exports.PreparedStatement = PreparedStatement;
exports.SqliteError = SqliteError;
exports.SqliteResultLimitError = SqliteResultLimitError;
