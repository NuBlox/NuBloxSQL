'use strict';

var sqlModule = require('./Sql');
var Metadata = require('./Metadata').Metadata;

var POSTGRES_METADATA_ALIASES = Object.freeze([
  'allowConnections', 'databaseName', 'schemaName', 'tableName', 'tableType',
  'columnName', 'ordinalPosition', 'columnDefault', 'isNullable', 'dataType',
  'nativeType', 'characterMaximumLength', 'numericPrecision', 'numericScale',
  'isIdentity', 'isGenerated', 'generationExpression', 'indexName', 'isUnique',
  'isPrimary', 'columnExpression', 'constraintName', 'referencedSchema',
  'referencedTable', 'referencedColumn', 'updateRule', 'deleteRule', 'matchOption',
  'constraintType'
]);

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

function normalizePostgresMetadataRows(rows) {
  rows.forEach(function (row) {
    POSTGRES_METADATA_ALIASES.forEach(function (name) {
      var folded = name.toLowerCase();
      if (row[name] === undefined && row[folded] !== undefined) row[name] = row[folded];
    });
  });
  return rows;
}

function metadataClientView(client) {
  if (client.dialect !== 'postgresql') return client;
  return {
    dialect: client.dialect,
    config: client.config,
    _ensureConnected: function _ensureConnected() {
      return client._ensureConnected.apply(client, arguments);
    },
    all: async function all(statement, options) {
      return normalizePostgresMetadataRows(await client.all(statement, options));
    }
  };
}

function resolvePreparedBindings(plan, bindings) {
  bindings = bindings || {};
  if (typeof bindings !== 'object' || Array.isArray(bindings)) {
    throw new TypeError('NuBloxSQL prepared statement bindings must be an object');
  }
  return plan.map(function (binding) {
    if (binding.kind === 'value') return binding.value;
    if (!Object.prototype.hasOwnProperty.call(bindings, binding.name)) {
      throw new RangeError('NuBloxSQL prepared statement is missing binding "' + binding.name + '"');
    }
    return bindings[binding.name];
  });
}

function PreparedClientStatement(client, target, nativeStatement, compiled, release) {
  this.client = client;
  this.dialect = client.dialect;
  this.text = compiled.text;
  this.bindings = Object.freeze(compiled.bindings.filter(function (binding) {
    return binding.kind === 'parameter';
  }).map(function (binding) { return binding.name; }));
  this.native = nativeStatement;
  this._target = target;
  this._plan = compiled.bindings;
  this._release = release || null;
  this.closed = false;
}

PreparedClientStatement.prototype._parameters = function _parameters(bindings) {
  if (this.closed) throw new Error('NuBloxSQL prepared statement is closed');
  return resolvePreparedBindings(this._plan, bindings);
};

PreparedClientStatement.prototype.query = async function query(bindings, options) {
  var parameters = this._parameters(bindings);
  var result;
  if (this.dialect === 'sqlite') result = this.native.all(parameters, options || {});
  else result = await this.native.execute(parameters, options || {});
  return normalizeResult(this.dialect, this.text, result);
};

PreparedClientStatement.prototype.all = async function all(bindings, options) {
  return (await this.query(bindings, options)).rows;
};

PreparedClientStatement.prototype.one = async function one(bindings, options) {
  var result = await this.query(bindings, options);
  if (result.rows.length !== 1) throw new Error('NuBloxSQL prepared one() expected exactly one row, received ' + result.rows.length);
  return result.rows[0];
};

PreparedClientStatement.prototype.execute = async function execute(bindings, options) {
  var parameters = this._parameters(bindings);
  var result;
  if (this.dialect === 'sqlite') result = this.native.run(parameters);
  else result = await this.native.execute(parameters, options || {});
  return normalizeResult(this.dialect, this.text, result);
};

PreparedClientStatement.prototype.close = async function close(options) {
  if (this.closed) return;
  this.closed = true;
  var closeError = null;
  try {
    if (this.native && typeof this.native.close === 'function') await this.native.close(options || {});
  } catch (error) {
    closeError = error;
  } finally {
    this.client._preparedStatements.delete(this);
    if (this._release) await this._release();
  }
  if (closeError) throw closeError;
};

function Client(adapter, dialect, config, target, ownsTarget) {
  this.adapter = adapter;
  this.dialect = dialect;
  this.config = config || {};
  this.descriptor = adapter.descriptor || null;
  this.capabilities = (this.descriptor && this.descriptor.capabilities) || adapter.capabilities || Object.freeze({});
  this._ownsTarget = ownsTarget !== false;
  this._preparedStatements = new Set();

  if (target) {
    this._target = target;
    this._isPool = false;
    this.metadata = new Metadata(metadataClientView(this));
    return;
  }

  if (typeof adapter.createPool === 'function' && this.config.pool !== false) {
    this._target = adapter.createPool(createPoolConfig(this.config));
    this._isPool = true;
  } else {
    this._target = adapter.createConnection(copyWithoutClientKeys(this.config));
    this._isPool = false;
  }
  this.metadata = new Metadata(metadataClientView(this));
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

Client.prototype.prepare = async function prepare(statement, options) {
  if (!this.supports('preparedStatements')) {
    throw new Error('NuBloxSQL dialect "' + this.dialect + '" does not support prepared statements');
  }
  options = options || {};
  var compiled;
  if (typeof statement === 'string') compiled = Object.freeze({ text: statement, bindings: Object.freeze([]) });
  else compiled = sqlModule.compilePrepared(statement, this.descriptor && this.descriptor.services);

  var target;
  var release = null;
  if (this._isPool) {
    target = await this._target.getConnection(options.acquire || {});
    var pool = this._target;
    release = async function releaseConnection() { await pool.releaseConnection(target); };
  } else {
    target = await this._ensureConnected();
  }

  var prepareOptions = Object.assign({}, options);
  delete prepareOptions.acquire;
  var nativeStatement;
  try {
    nativeStatement = await Promise.resolve(target.prepare(compiled.text, prepareOptions));
  } catch (error) {
    if (release) await release();
    throw error;
  }

  var statementHandle = new PreparedClientStatement(this, target, nativeStatement, compiled, release);
  this._preparedStatements.add(statementHandle);
  return statementHandle;
};

Client.prototype._closePreparedStatements = async function _closePreparedStatements() {
  var statements = Array.from(this._preparedStatements);
  var firstError = null;
  for (var i = 0; i < statements.length; i++) {
    try { await statements[i].close(); }
    catch (error) { if (!firstError) firstError = error; }
  }
  if (firstError) throw firstError;
};

Client.prototype.transaction = async function transaction(fn, options) {
  if (typeof fn !== 'function') throw new TypeError('NuBloxSQL transaction requires a function');
  options = options || {};
  var self = this;

  if (this._isPool && typeof this._target.withTransaction === 'function') {
    return this._target.withTransaction(async function (connection) {
      var transactionClient = new Client(self.adapter, self.dialect, self.config, connection, false);
      try { return await fn(transactionClient); }
      finally { await transactionClient._closePreparedStatements(); }
    }, options);
  }

  var connection = await this._ensureConnected();
  if (this.dialect === 'sqlite') {
    connection.begin(options.mode || 'deferred');
    var sqliteTransactionClient = new Client(this.adapter, this.dialect, this.config, connection, false);
    try {
      var value = await fn(sqliteTransactionClient);
      await sqliteTransactionClient._closePreparedStatements();
      connection.commit();
      return value;
    } catch (error) {
      try { await sqliteTransactionClient._closePreparedStatements(); } catch (resourceError) { error.resourceError = resourceError; }
      try { connection.rollback(); } catch (rollbackError) { error.rollbackError = rollbackError; }
      throw error;
    }
  }

  if (typeof connection.withTransaction !== 'function') throw new Error('NuBloxSQL dialect "' + this.dialect + '" does not support transactions');
  return connection.withTransaction(async function (transactionConnection) {
    var transactionClient = new Client(self.adapter, self.dialect, self.config, transactionConnection, false);
    try { return await fn(transactionClient); }
    finally { await transactionClient._closePreparedStatements(); }
  }, options);
};

Client.prototype.close = async function close() {
  await this._closePreparedStatements();
  if (!this._ownsTarget || !this._target) return;
  if (typeof this._target.end === 'function') return this._target.end();
  if (typeof this._target.close === 'function') return this._target.close();
};

exports.Client = Client;
exports.PreparedClientStatement = PreparedClientStatement;
exports.normalizeResult = normalizeResult;
exports.resolvePreparedBindings = resolvePreparedBindings;