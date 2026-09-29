'use strict';

var prepared = require('./PreparedConnection');
var client = require('./protocol/ClientPackets');

var ISOLATION_LEVELS = Object.freeze({
  'read-uncommitted': 'READ UNCOMMITTED',
  'read-committed': 'READ COMMITTED',
  'repeatable-read': 'REPEATABLE READ',
  serializable: 'SERIALIZABLE'
});

function Connection(config) {
  prepared.Connection.call(this, config);
  this.inTransaction = false;
}
Connection.prototype = Object.create(prepared.Connection.prototype);
Connection.prototype.constructor = Connection;

Connection.prototype.beginTransaction = async function beginTransaction(options) {
  options = options || {};
  if (this.inTransaction) throw new Error('MySQL transaction is already active');
  if (options.isolationLevel) {
    var level = ISOLATION_LEVELS[options.isolationLevel];
    if (!level) throw new RangeError('Unsupported MySQL transaction isolation level: ' + options.isolationLevel);
    await this.query('SET TRANSACTION ISOLATION LEVEL ' + level, options);
  }
  var clauses = [];
  if (options.readOnly === true) clauses.push('READ ONLY');
  else if (options.readOnly === false) clauses.push('READ WRITE');
  await this.query('START TRANSACTION' + (clauses.length ? ' ' + clauses.join(', ') : ''), options);
  this.inTransaction = true;
  return this;
};

Connection.prototype.commit = async function commit(options) {
  if (!this.inTransaction) throw new Error('No active MySQL transaction to commit');
  try {
    return await this.query('COMMIT', options || {});
  } finally {
    this.inTransaction = false;
  }
};

Connection.prototype.rollback = async function rollback(options) {
  if (!this.inTransaction) throw new Error('No active MySQL transaction to roll back');
  try {
    return await this.query('ROLLBACK', options || {});
  } finally {
    this.inTransaction = false;
  }
};

Connection.prototype.withTransaction = async function withTransaction(fn, options) {
  if (typeof fn !== 'function') throw new TypeError('withTransaction requires a function');
  await this.beginTransaction(options || {});
  try {
    var value = await fn(this);
    await this.commit(options || {});
    return value;
  } catch (error) {
    if (this.inTransaction && this.connected && !this.ended) {
      try { await this.rollback(options || {}); } catch (rollbackError) { error.rollbackError = rollbackError; }
    }
    throw error;
  }
};

Connection.prototype.savepoint = function savepoint(name, options) {
  if (!this.inTransaction) return Promise.reject(new Error('Savepoints require an active MySQL transaction'));
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(String(name))) return Promise.reject(new TypeError('Invalid MySQL savepoint name'));
  return this.query('SAVEPOINT `' + String(name).replace(/`/g, '``') + '`', options || {});
};

Connection.prototype.rollbackToSavepoint = function rollbackToSavepoint(name, options) {
  if (!this.inTransaction) return Promise.reject(new Error('Savepoints require an active MySQL transaction'));
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(String(name))) return Promise.reject(new TypeError('Invalid MySQL savepoint name'));
  return this.query('ROLLBACK TO SAVEPOINT `' + String(name).replace(/`/g, '``') + '`', options || {});
};

Connection.prototype.releaseSavepoint = function releaseSavepoint(name, options) {
  if (!this.inTransaction) return Promise.reject(new Error('Savepoints require an active MySQL transaction'));
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(String(name))) return Promise.reject(new TypeError('Invalid MySQL savepoint name'));
  return this.query('RELEASE SAVEPOINT `' + String(name).replace(/`/g, '``') + '`', options || {});
};

Connection.prototype.resetSession = function resetSession(options) {
  var self = this;
  var state = { phase: 'start' };
  return this._startOperation('session-reset', state, client.encodeResetConnection(), options || {}).then(function (result) {
    self.inTransaction = false;
    self.emit('reset');
    return result;
  });
};

exports.Connection = Connection;
exports.PreparedStatement = prepared.PreparedStatement;
exports.ISOLATION_LEVELS = ISOLATION_LEVELS;
