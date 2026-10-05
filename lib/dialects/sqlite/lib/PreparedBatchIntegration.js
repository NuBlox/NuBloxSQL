'use strict';

function quoteIdentifier(value) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError('SQLite prepared batch identifier must be non-empty');
  if (value.indexOf('\0') !== -1) throw new TypeError('SQLite prepared batch identifier cannot contain NUL bytes');
  return '"' + value.replace(/"/g, '""') + '"';
}

function tableSql(parts) {
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > 2) {
    throw new TypeError('SQLite prepared batch table must contain one table name or database and table names');
  }
  return parts.map(quoteIdentifier).join('.');
}

function normalizeValue(value) {
  if (value === null) return { supported: true, value: null };
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    if (typeof value === 'number' && !Number.isFinite(value)) return { supported: false };
    return { supported: true, value: value };
  }
  if (typeof value === 'boolean') return { supported: true, value: value ? 1 : 0 };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { supported: true, value: value };
  if (value instanceof ArrayBuffer) return { supported: true, value: new Uint8Array(value) };
  if (ArrayBuffer.isView(value)) {
    return { supported: true, value: new Uint8Array(value.buffer, value.byteOffset, value.byteLength) };
  }
  return { supported: false };
}

function normalizeRows(columnNames, rows) {
  var normalized = [];
  for (var r = 0; r < rows.length; r += 1) {
    var values = [];
    for (var c = 0; c < columnNames.length; c += 1) {
      var value = rows[r][columnNames[c]];
      if (value === undefined) value = null;
      var converted = normalizeValue(value);
      if (!converted.supported) return null;
      values.push(converted.value);
    }
    normalized.push(values);
  }
  return normalized;
}

function install(runtime) {
  var Connection = runtime && runtime.Connection;
  if (!Connection || !Connection.prototype || Connection.prototype.insertMany) return;

  Connection.prototype.insertMany = function insertMany(tableParts, columnNames, rows, options) {
    options = options || {};
    this._assertOpen();

    if (!Array.isArray(columnNames) || !columnNames.length || columnNames.some(function (name) {
      return typeof name !== 'string' || name.length === 0;
    })) {
      throw new TypeError('SQLite prepared batch columns must be a non-empty array of identifiers');
    }
    if (!Array.isArray(rows)) throw new TypeError('SQLite prepared batch rows must be an array');
    if (!rows.length) {
      return Object.freeze({
        kind: 'command',
        affectedRows: 0n,
        rowCount: 0,
        strategy: 'sqlite-prepared-transaction'
      });
    }

    var bindings = normalizeRows(columnNames, rows);
    if (bindings === null) return null;

    if (this.isTransaction()) {
      throw new runtime.SqliteError(
        'SQLite prepared data movement requires ownership of the batch transaction so checkpoints only advance after commit',
        { code: 'NUBLOXSQL_SQLITE_BATCH_TRANSACTION_ACTIVE', category: 'state' }
      );
    }

    var mode = options.transactionMode === undefined ? 'immediate' : String(options.transactionMode).toLowerCase();
    if (['deferred', 'immediate', 'exclusive'].indexOf(mode) === -1) {
      throw new RangeError('SQLite prepared batch transactionMode must be deferred, immediate or exclusive');
    }

    var statement =
      'INSERT INTO ' + tableSql(tableParts) +
      ' (' + columnNames.map(quoteIdentifier).join(', ') + ')' +
      ' VALUES (' + columnNames.map(function () { return '?'; }).join(', ') + ')';
    var prepared = this.prepare(statement);
    var affected = 0n;

    this.begin(mode);
    try {
      for (var i = 0; i < bindings.length; i += 1) {
        var result = prepared.run(bindings[i]);
        if (result && result.affectedRows !== undefined && result.affectedRows !== null) {
          affected += BigInt(result.affectedRows);
        }
      }
      this.commit();
    } catch (error) {
      try { if (this.isTransaction()) this.rollback(); } catch (_) {}
      throw error;
    }

    return Object.freeze({
      kind: 'command',
      affectedRows: affected,
      rowCount: rows.length,
      strategy: 'sqlite-prepared-transaction'
    });
  };
}

exports.install = install;
exports.quoteIdentifier = quoteIdentifier;
exports.tableSql = tableSql;
exports.normalizeValue = normalizeValue;
exports.normalizeRows = normalizeRows;
