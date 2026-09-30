'use strict';

function validateDatabaseName(value) {
  value = value || 'main';
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new TypeError('SQLite database name must be a simple SQL identifier');
  return value;
}

function validateObjectName(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new TypeError('SQLite ' + label + ' must be a simple SQL identifier');
  return value;
}

function quoteIdentifier(value) { return '"' + String(value).replace(/"/g, '""') + '"'; }
function quoteLiteral(value) { return "'" + String(value).replace(/'/g, "''") + "'"; }

function positiveInteger(name, value) {
  if (!Number.isInteger(value) || value < 1) throw new RangeError('SQLite ' + name + ' must be a positive integer');
  return value;
}

function rows(connection, sql) {
  return connection.query(sql).rows.map(function (row) { return Object.freeze(Object.assign({}, row)); });
}

function check(connection, kind, options) {
  options = options || {};
  var database = validateDatabaseName(options.database || 'main');
  var maxErrors = options.maxErrors === undefined ? 100 : positiveInteger('maxErrors', options.maxErrors);
  var pragma = kind === 'quick' ? 'quick_check' : 'integrity_check';
  var result = rows(connection, 'PRAGMA ' + quoteIdentifier(database) + '.' + pragma + '(' + maxErrors + ')');
  var messages = result.map(function (row) { var keys = Object.keys(row); return String(row[keys[0]]); });
  return Object.freeze({ database: database, kind: kind, ok: messages.length === 1 && messages[0].toLowerCase() === 'ok', messages: Object.freeze(messages), native: Object.freeze(result) });
}

function foreignKeyCheck(connection, options) {
  options = options || {};
  var database = validateDatabaseName(options.database || 'main');
  var sql = 'PRAGMA ' + quoteIdentifier(database) + '.foreign_key_check';
  if (options.table !== undefined) sql += '(' + quoteLiteral(validateObjectName(options.table, 'table name')) + ')';
  var violations = rows(connection, sql).map(function (row) {
    return Object.freeze({
      table: row.table === undefined ? null : String(row.table),
      rowid: row.rowid === undefined || row.rowid === null ? null : row.rowid,
      parent: row.parent === undefined ? null : String(row.parent),
      foreignKeyId: row.fkid === undefined || row.fkid === null ? null : Number(row.fkid),
      native: row
    });
  });
  return Object.freeze({ database: database, ok: violations.length === 0, violations: Object.freeze(violations) });
}

function analyze(connection, options) {
  options = options || {};
  var database = validateDatabaseName(options.database || 'main');
  var sql = 'ANALYZE ' + quoteIdentifier(database);
  if (options.target !== undefined) sql += '.' + quoteIdentifier(validateObjectName(options.target, 'analysis target'));
  connection.exec(sql);
  return Object.freeze({ database: database, target: options.target || null });
}

function optimize(connection, options) {
  options = options || {};
  var database = validateDatabaseName(options.database || 'main');
  var mask = options.mask;
  if (mask !== undefined && (!Number.isInteger(mask) || mask < 0)) throw new RangeError('SQLite optimize mask must be a non-negative integer');
  var sql = 'PRAGMA ' + quoteIdentifier(database) + '.optimize' + (mask === undefined ? '' : '(' + mask + ')');
  var result = rows(connection, sql);
  return Object.freeze({ database: database, mask: mask === undefined ? null : mask, native: Object.freeze(result) });
}

function vacuum(connection, options) {
  options = options || {};
  var database = validateDatabaseName(options.database || 'main');
  var sql = 'VACUUM ' + quoteIdentifier(database);
  if (options.into !== undefined) {
    if (typeof options.into !== 'string' || options.into.length === 0) throw new TypeError('SQLite vacuum into path must be a non-empty string');
    sql += ' INTO ' + quoteLiteral(options.into);
  }
  connection.exec(sql);
  return Object.freeze({ database: database, into: options.into || null });
}

function incrementalVacuum(connection, pages, database) {
  database = validateDatabaseName(database || 'main');
  if (pages !== undefined && (!Number.isInteger(pages) || pages < 0)) throw new RangeError('SQLite incremental vacuum pages must be a non-negative integer');
  var sql = 'PRAGMA ' + quoteIdentifier(database) + '.incremental_vacuum' + (pages === undefined ? '' : '(' + pages + ')');
  connection.exec(sql);
  return Object.freeze({ database: database, pages: pages === undefined ? null : pages });
}

exports.integrityCheck = function (connection, options) { return check(connection, 'integrity', options); };
exports.quickCheck = function (connection, options) { return check(connection, 'quick', options); };
exports.foreignKeyCheck = foreignKeyCheck;
exports.analyze = analyze;
exports.optimize = optimize;
exports.vacuum = vacuum;
exports.incrementalVacuum = incrementalVacuum;
