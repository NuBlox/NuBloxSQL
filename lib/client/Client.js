'use strict';

var sqlModule = require('./Sql');

function copyWithoutClientKeys(config) {
  var out = {};
  Object.keys(config || {}).forEach(function (key) {
    if (key !== 'dialect' && key !== 'pool') out[key] = config[key];
  });
  return out;
}

function createPoolConfig(config) {
  var out = copyWithoutClientKeys(config);
  var pool = config && config.pool;
  if (!pool || pool === true) return out;
  if (typeof pool !== 'object' || Array.isArray(pool)) throw new TypeError('NuBloxSQL pool must be false, true, or an options object');
  Object.keys(pool).forEach(function (key) {
    if (key === 'max') out.connectionLimit = pool[key];
    else out[key] = pool[key];
  });
  return out;
}

function inferCommand(text) {
  var match = String(text || '').trim().match(/^([A-Za-z]+)/);
  return match ? match[1].toUpperCase() : '';
}

function normalizeResult(dialect, text, result) {
  result = result || {};
  var rows = Array.isArray(result.rows) ? result.rows : [];
  var fields = Array.isArray(result.fields) ? result.fields : [];
  var rowCount = result.rowCount;
  if (rowCount === undefined || rowCount === null) rowCount = rows.length;
  var affectedRows = result.affectedRows;
  if (affectedRows === undefined && result.changes !== undefined) affectedRows = result.changes;
  return {
    rows: rows,
    fields: fields,
    rowCount: rowCount,
    affectedRows: affectedRows === undefined ? null : affectedRows,
    insertId: result.insertId === undefined ? null : result.insertId,
    command: result.command || inferCommand(text),
    dialect: dialect,
    native: result
  };
}

function Client(adapter, dialect, config, target, ownsTarget) {
  this.adapter = adapter;
  this.dialect = dialect;
  this.config = config || {};
  this.descriptor = adapter.descriptor || null;
  this.capabilities = (this.descriptor && this.descriptor.capabilities) || adapter.capabilities || Object.freeze({});
  this._ownsTarget = ownsTarget !== false;

  if (target) {
    this._target = target;
    this._isPool = false;
    return;
  }

  if (typeof adapter.createPool === 'function' && this.config.pool !== false) {
    this._target = adapter.createPool(createPoolConfig(this.config));
    this._isPool = true;
  } else {
    this._target = adapter.createConnection(copyWithoutClientKeys(this.config));
    this._isPool = false;
  }
}

Object.defineProperty(Client.prototype, 'native', {
  enumerable: true,
  get: function () { return this._target; }
});

Client.prototype.supports = function supports(capability) {
  return !!(this.descriptor && typeof this.descriptor.supports === 'function' && this.descriptor.supports(capability));
};

Client.prototype.compile = function compile(statement) {
  if (typeof statement === 'string') return Object.freeze({ text: statement, parameters: Object.freeze([]) });
  return sqlModule.compile(statement, this.descriptor && this.descriptor.services);
};

Client.prototype._ensureConnected = async function _ensureConnected(target) {
  target = target || this._target;
  if (this._isPool) return target;
  if (typeof target.connect === 'function' && !target.connected && !target.ended) await target.connect();
  return target;
};

Client.prototype._queryTarget = async function _queryTarget(target, compiled, options) {
  options = options || {};
  if (this.dialect === 'sqlite') return target.query(compiled.text, compiled.parameters, options);
  if (compiled.parameters.length && typeof target.execute === 'function') return target.execute(compiled.text, compiled.parameters, options);
  if (compiled.parameters.length && typeof target.prepare === 'function') {
    var prepared = await target.prepare(compiled.text, options);
    try { return await prepared.execute(compiled.parameters, options); }
    finally { await prepared.close(); }
  }
  return target.query(compiled.text, options);
};

Client.prototype._executeTarget = async function _executeTarget(target, compiled, options) {
  options = options || {};
  if (this.dialect === 'sqlite') return target.run(compiled.text, compiled.parameters, options);
  if (typeof target.execute === 'function') return target.execute(compiled.text, compiled.parameters, options);
  if (typeof target.prepare === 'function') {
    var prepared = await target.prepare(compiled.text, options);
    try { return await prepared.execute(compiled.parameters, options); }
    finally { await prepared.close(); }
  }
  return target.query(compiled.text, options);
};

Client.prototype.query = async function query(statement, options) {
  var compiled = this.compile(statement);
  var target = await this._ensureConnected();
  var result = await this._queryTarget(target, compiled, options);
  return normalizeResult(this.dialect, compiled.text, result);
};

Client.prototype.all = async function all(statement, options) {
  return (await this.query(statement, options)).rows;
};

Client.prototype.one = async function one(statement, options) {
  var result = await this.query(statement, options);
  if (result.rows.length !== 1) throw new Error('NuBloxSQL one() expected exactly one row, received ' + result.rows.length);
  return result.rows[0];
};

Client.prototype.execute = async function execute(statement, options) {
  var compiled = this.compile(statement);
  var target = await this._ensureConnected();
  var result = await this._executeTarget(target, compiled, options);
  return normalizeResult(this.dialect, compiled.text, result);
};

Client.prototype.transaction = async function transaction(fn, options) {
  if (typeof fn !== 'function') throw new TypeError('NuBloxSQL transaction requires a function');
  options = options || {};
  var self = this;

  if (this._isPool && typeof this._target.withTransaction === 'function') {
    return this._target.withTransaction(function (connection) {
      return fn(new Client(self.adapter, self.dialect, self.config, connection, false));
    }, options);
  }

  var connection = await this._ensureConnected();
  if (this.dialect === 'sqlite') {
    connection.begin(options.mode || 'deferred');
    try {
      var value = await fn(new Client(this.adapter, this.dialect, this.config, connection, false));
      connection.commit();
      return value;
    } catch (error) {
      try { connection.rollback(); } catch (rollbackError) { error.rollbackError = rollbackError; }
      throw error;
    }
  }

  if (typeof connection.withTransaction !== 'function') throw new Error('NuBloxSQL dialect "' + this.dialect + '" does not support transactions');
  return connection.withTransaction(function (transactionConnection) {
    return fn(new Client(self.adapter, self.dialect, self.config, transactionConnection, false));
  }, options);
};

Client.prototype.close = async function close() {
  if (!this._ownsTarget || !this._target) return;
  if (typeof this._target.end === 'function') return this._target.end();
  if (typeof this._target.close === 'function') return this._target.close();
};

exports.Client = Client;
exports.normalizeResult = normalizeResult;
