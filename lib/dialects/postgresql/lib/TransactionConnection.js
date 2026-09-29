'use strict';

var cancellable = require('./CancellableConnection');

var ISOLATION_LEVELS = Object.freeze({
  'read-uncommitted': 'READ UNCOMMITTED',
  'read-committed': 'READ COMMITTED',
  'repeatable-read': 'REPEATABLE READ',
  serializable: 'SERIALIZABLE'
});

function quoteIdentifier(value) {
  value = String(value);
  if (!value.length || value.indexOf('\0') !== -1) throw new TypeError('PostgreSQL identifier must be non-empty and cannot contain NUL bytes');
  return '"' + value.replace(/"/g, '""') + '"';
}

function Connection(config) {
  cancellable.Connection.call(this, config);
}
Connection.prototype = Object.create(cancellable.Connection.prototype);
Connection.prototype.constructor = Connection;

Connection.prototype.beginTransaction = function beginTransaction(options) {
  options = options || {};
  if (this.transactionStatus && this.transactionStatus !== 'I') return Promise.reject(new Error('PostgreSQL transaction is already active'));
  var clauses = [];
  if (options.isolationLevel !== undefined) {
    var level = ISOLATION_LEVELS[options.isolationLevel];
    if (!level) return Promise.reject(new RangeError('Unsupported PostgreSQL transaction isolation level: ' + options.isolationLevel));
    clauses.push('ISOLATION LEVEL ' + level);
  }
  if (options.readOnly === true) clauses.push('READ ONLY');
  else if (options.readOnly === false) clauses.push('READ WRITE');
  if (options.deferrable === true) clauses.push('DEFERRABLE');
  else if (options.deferrable === false) clauses.push('NOT DEFERRABLE');
  return this.query('BEGIN' + (clauses.length ? ' ' + clauses.join(' ') : ''), options);
};

Connection.prototype.commit = function commit(options) {
  if (this.transactionStatus === 'E') return Promise.reject(new Error('PostgreSQL transaction is aborted; rollback is required'));
  if (this.transactionStatus !== 'T') return Promise.reject(new Error('No active PostgreSQL transaction to commit'));
  return this.query('COMMIT', options || {});
};

Connection.prototype.rollback = function rollback(options) {
  if (this.transactionStatus !== 'T' && this.transactionStatus !== 'E') return Promise.reject(new Error('No active PostgreSQL transaction to roll back'));
  return this.query('ROLLBACK', options || {});
};

Connection.prototype.withTransaction = async function withTransaction(fn, options) {
  if (typeof fn !== 'function') throw new TypeError('PostgreSQL withTransaction requires a function');
  await this.beginTransaction(options || {});
  try {
    var value = await fn(this);
    await this.commit(options || {});
    return value;
  } catch (error) {
    if (this.connected && !this.ended && (this.transactionStatus === 'T' || this.transactionStatus === 'E')) {
      try { await this.rollback(options || {}); } catch (rollbackError) { error.rollbackError = rollbackError; }
    }
    throw error;
  }
};

Connection.prototype.savepoint = function savepoint(name, options) {
  if (this.transactionStatus !== 'T') return Promise.reject(new Error('PostgreSQL savepoints require an active transaction'));
  return this.query('SAVEPOINT ' + quoteIdentifier(name), options || {});
};

Connection.prototype.rollbackToSavepoint = function rollbackToSavepoint(name, options) {
  if (this.transactionStatus !== 'T' && this.transactionStatus !== 'E') return Promise.reject(new Error('PostgreSQL savepoints require an active transaction'));
  return this.query('ROLLBACK TO SAVEPOINT ' + quoteIdentifier(name), options || {});
};

Connection.prototype.releaseSavepoint = function releaseSavepoint(name, options) {
  if (this.transactionStatus !== 'T') return Promise.reject(new Error('PostgreSQL savepoints require an active transaction'));
  return this.query('RELEASE SAVEPOINT ' + quoteIdentifier(name), options || {});
};

Connection.prototype.resetSession = async function resetSession(options) {
  options = options || {};
  if (this._currentQuery) throw new Error('Cannot reset PostgreSQL session while an operation is active');
  if (this.transactionStatus === 'T' || this.transactionStatus === 'E') await this.query('ROLLBACK', options);
  await this.query('DISCARD ALL', options);
  this._statementCounter = 0;
  this.emit('reset');
  return this;
};

exports.Connection = Connection;
exports.PreparedStatement = cancellable.PreparedStatement;
exports.PostgreSqlError = cancellable.PostgreSqlError;
exports.PostgreSqlCancellationError = cancellable.PostgreSqlCancellationError;
exports.ISOLATION_LEVELS = ISOLATION_LEVELS;
exports.quoteIdentifier = quoteIdentifier;
