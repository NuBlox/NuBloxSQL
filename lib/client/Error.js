'use strict';

var CATEGORIES = Object.freeze({
  AUTHENTICATION: 'authentication',
  AUTHORIZATION: 'authorization',
  CONNECTION: 'connection',
  TIMEOUT: 'timeout',
  CANCELLED: 'cancelled',
  CONSTRAINT: 'constraint',
  UNIQUE_VIOLATION: 'unique_violation',
  FOREIGN_KEY_VIOLATION: 'foreign_key_violation',
  NOT_NULL_VIOLATION: 'not_null_violation',
  SYNTAX: 'syntax',
  DEADLOCK: 'deadlock',
  SERIALIZATION: 'serialization',
  RESOURCE_LIMIT: 'resource_limit',
  STATE: 'state',
  CARDINALITY: 'cardinality',
  UNSUPPORTED: 'unsupported',
  UNKNOWN: 'unknown'
});

function portableCode(category) {
  return 'NUBLOXSQL_' + String(category || CATEGORIES.UNKNOWN).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}
function NuBloxSqlError(message, details) {
  details = details || {};
  Error.call(this, message);
  this.name = 'NuBloxSqlError';
  this.message = message;
  this.code = details.code || portableCode(details.category);
  this.category = details.category || CATEGORIES.UNKNOWN;
  this.dialect = details.dialect || null;
  this.operation = details.operation || null;
  this.retryable = details.retryable === true;
  this.sqlState = details.sqlState || null;
  this.nativeCode = details.nativeCode === undefined ? null : details.nativeCode;
  this.native = details.native || null;
  if (details.cause !== undefined) this.cause = details.cause;
  if (Error.captureStackTrace) Error.captureStackTrace(this, NuBloxSqlError);
}
NuBloxSqlError.prototype = Object.create(Error.prototype);
NuBloxSqlError.prototype.constructor = NuBloxSqlError;
function normalizeCategory(value) {
  if (!value) return null;
  value = String(value).toLowerCase().replace(/-/g, '_');
  if (value === 'resource_limit') return CATEGORIES.RESOURCE_LIMIT;
  if (Object.keys(CATEGORIES).some(function (key) { return CATEGORIES[key] === value; })) return value;
  return null;
}
function classifyPostgreSql(error) {
  var state = error && (error.code || error.sqlState);
  if (!state || typeof state !== 'string') return null;
  if (state === '23505') return CATEGORIES.UNIQUE_VIOLATION;
  if (state === '23503') return CATEGORIES.FOREIGN_KEY_VIOLATION;
  if (state === '23502') return CATEGORIES.NOT_NULL_VIOLATION;
  if (state === '42601') return CATEGORIES.SYNTAX;
  if (state === '40P01') return CATEGORIES.DEADLOCK;
  if (state === '40001') return CATEGORIES.SERIALIZATION;
  if (state === '57014') return CATEGORIES.CANCELLED;
  if (state === '28P01' || state === '28000') return CATEGORIES.AUTHENTICATION;
  if (state === '42501') return CATEGORIES.AUTHORIZATION;
  if (state.slice(0, 2) === '08') return CATEGORIES.CONNECTION;
  if (state.slice(0, 2) === '23') return CATEGORIES.CONSTRAINT;
  return null;
}
function classifyMySql(error) {
  var code = error && error.code;
  if (typeof code === 'string' && /^\d+$/.test(code)) code = Number(code);
  if (code === 1062) return CATEGORIES.UNIQUE_VIOLATION;
  if (code === 1451 || code === 1452) return CATEGORIES.FOREIGN_KEY_VIOLATION;
  if (code === 1048 || code === 1364) return CATEGORIES.NOT_NULL_VIOLATION;
  if (code === 1064) return CATEGORIES.SYNTAX;
  if (code === 1213) return CATEGORIES.DEADLOCK;
  if (code === 1205) return CATEGORIES.TIMEOUT;
  if (code === 1045) return CATEGORIES.AUTHENTICATION;
  if (code === 1044 || code === 1142 || code === 1143) return CATEGORIES.AUTHORIZATION;
  if (code === 2002 || code === 2003 || code === 2006 || code === 2013) return CATEGORIES.CONNECTION;
  return null;
}
function classifySqlite(error) {
  var extended = error && error.sqliteCode;
  if (extended === 1555 || extended === 2067) return CATEGORIES.UNIQUE_VIOLATION;
  if (extended === 787) return CATEGORIES.FOREIGN_KEY_VIOLATION;
  if (extended === 1299) return CATEGORIES.NOT_NULL_VIOLATION;
  var code = error && error.code;
  if (typeof code !== 'string') return null;
  if (code.indexOf('SQLITE_CONSTRAINT_UNIQUE') >= 0 || code.indexOf('SQLITE_CONSTRAINT_PRIMARYKEY') >= 0) return CATEGORIES.UNIQUE_VIOLATION;
  if (code.indexOf('SQLITE_CONSTRAINT_FOREIGNKEY') >= 0) return CATEGORIES.FOREIGN_KEY_VIOLATION;
  if (code.indexOf('SQLITE_CONSTRAINT_NOTNULL') >= 0) return CATEGORIES.NOT_NULL_VIOLATION;
  if (code.indexOf('SQLITE_CONSTRAINT') >= 0) return CATEGORIES.CONSTRAINT;
  if (code.indexOf('SQLITE_BUSY') >= 0 || code.indexOf('SQLITE_LOCKED') >= 0) return CATEGORIES.TIMEOUT;
  if (code.indexOf('SQLITE_CANTOPEN') >= 0 || code.indexOf('SQLITE_IOERR') >= 0 || code.indexOf('SQLITE_NOTADB') >= 0 || code.indexOf('SQLITE_CORRUPT') >= 0 || code.indexOf('SQLITE_FORMAT') >= 0) return CATEGORIES.CONNECTION;
  if (code === 'SQLITE_ERROR' || code === 'ERR_SQLITE_ERROR') return CATEGORIES.SYNTAX;
  return null;
}
function classifySqlServer(error) {
  var code = error && error.code;
  if (typeof code === 'string' && /^\d+$/.test(code)) code = Number(code);
  if (code === 'NUBLOX_SQLSERVER_CANCELLED') return CATEGORIES.CANCELLED;
  if (code === 'NUBLOX_SQLSERVER_TIMEOUT' || code === 'NUBLOX_SQLSERVER_ATTENTION_TIMEOUT') return CATEGORIES.TIMEOUT;
  if (code === 'NUBLOX_SQLSERVER_CANCEL_SYNC') return CATEGORIES.CONNECTION;
  if (code === 2601 || code === 2627) return CATEGORIES.UNIQUE_VIOLATION;
  if (code === 547) return CATEGORIES.FOREIGN_KEY_VIOLATION;
  if (code === 515) return CATEGORIES.NOT_NULL_VIOLATION;
  if (code === 102 || code === 156) return CATEGORIES.SYNTAX;
  if (code === 1205) return CATEGORIES.DEADLOCK;
  if (code === 1222) return CATEGORIES.TIMEOUT;
  if (code === 18456) return CATEGORIES.AUTHENTICATION;
  if (code === 229) return CATEGORIES.AUTHORIZATION;
  if (code === 233 || code === 10053 || code === 10054 || code === 10060) return CATEGORIES.CONNECTION;
  return null;
}
function hasDatabaseSignal(dialect, error) {
  if (!error || typeof error !== 'object') return false;
  if (error instanceof NuBloxSqlError) return true;
  if (/^(MySql|PostgreSql|Sqlite|SqlServer)/.test(error.name || '')) return true;
  if (dialect === 'postgresql' && typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)) return true;
  if (dialect === 'mysql' && (typeof error.code === 'number' || /^NUBLOX_MYSQL_/.test(String(error.code || '')))) return true;
  if (dialect === 'sqlite' && /SQLITE_/.test(String(error.code || ''))) return true;
  if (dialect === 'sqlserver' && (typeof error.code === 'number' || /^NUBLOX_SQLSERVER_/.test(String(error.code || '')))) return true;
  if (/^(ECONN|EPIPE|ETIMEDOUT|EHOST|ENET)/.test(String(error.code || ''))) return true;
  return false;
}
function classify(dialect, error) {
  var category = normalizeCategory(error && error.category);
  if (dialect === 'postgresql') category = classifyPostgreSql(error) || category;
  else if (dialect === 'mysql') category = classifyMySql(error) || category;
  else if (dialect === 'sqlite') category = classifySqlite(error) || category;
  else if (dialect === 'sqlserver') category = classifySqlServer(error) || category;
  var code = String(error && error.code || '');
  var name = String(error && error.name || '');
  var message = String(error && error.message || '').toLowerCase();
  if (/CANCEL|ABORT/.test(code) || /Cancellation/.test(name) || message.indexOf('aborted') >= 0 || message.indexOf('cancelled') >= 0) category = CATEGORIES.CANCELLED;
  else if (/TIMEOUT/.test(code) || message.indexOf('timed out') >= 0 || message.indexOf('timeout') >= 0 || message.indexOf('deadline exceeded') >= 0) category = CATEGORIES.TIMEOUT;
  else if (/^(ECONN|EPIPE|EHOST|ENET)/.test(code)) category = CATEGORIES.CONNECTION;
  return category || CATEGORIES.UNKNOWN;
}
function defaultRetryable(category, error) {
  if (error && error.retryable === true) return true;
  var code = String(error && error.code || '');
  if (code.indexOf('SQLITE_NOTADB') >= 0 || code.indexOf('SQLITE_CORRUPT') >= 0 || code.indexOf('SQLITE_FORMAT') >= 0) return false;
  return category === CATEGORIES.CONNECTION || category === CATEGORIES.TIMEOUT || category === CATEGORIES.DEADLOCK || category === CATEGORIES.SERIALIZATION;
}
function normalizeError(dialect, error, operation) {
  if (!error || error instanceof NuBloxSqlError) return error;
  if (error instanceof TypeError || error instanceof RangeError) return error;
  if (!hasDatabaseSignal(dialect, error)) return error;
  var category = classify(dialect, error);
  var sqlState = error.sqlState || (dialect === 'postgresql' && typeof error.code === 'string' ? error.code : null);
  return new NuBloxSqlError(error.message || (dialect + ' operation failed'), {
    category: category,
    dialect: dialect,
    operation: operation || null,
    retryable: defaultRetryable(category, error),
    sqlState: sqlState,
    nativeCode: error.code === undefined ? (error.sqliteCode === undefined ? null : error.sqliteCode) : error.code,
    native: error,
    cause: error
  });
}
function cardinalityError(dialect, operation, expected, actual) {
  return new NuBloxSqlError('NuBloxSQL ' + operation + ' expected ' + expected + ', received ' + actual, { category:CATEGORIES.CARDINALITY,dialect:dialect,operation:operation,retryable:false,native:null });
}
function unsupportedError(dialect, feature) {
  return new NuBloxSqlError('NuBloxSQL dialect "' + dialect + '" does not support ' + feature, { category:CATEGORIES.UNSUPPORTED,dialect:dialect,operation:feature,retryable:false,native:null });
}
exports.CATEGORIES = CATEGORIES;
exports.NuBloxSqlError = NuBloxSqlError;
exports.normalizeError = normalizeError;
exports.cardinalityError = cardinalityError;
exports.unsupportedError = unsupportedError;
