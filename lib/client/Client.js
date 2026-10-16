'use strict';

var sqlModule = require('./Sql');
var resultNormalization = require('./runtime/ResultNormalization');
var preparedBindings = require('./runtime/PreparedBindings');
var connectionTargets = require('./runtime/ConnectionTargets');
var transactionRunner = require('./runtime/TransactionRunner');
var normalizeResult = resultNormalization.normalizeResult;
var resolvePreparedBindings = preparedBindings.resolvePreparedBindings;
var parameterTypeOids = preparedBindings.parameterTypeOids;
var parameterTypeOidsFromValues = preparedBindings.parameterTypeOidsFromValues;
var bindParameters = preparedBindings.bindParameters;
var operationOptionsForTypedValues = preparedBindings.operationOptionsForTypedValues;
var Metadata = require('./Metadata').Metadata;
var migrationExecutor = require('./engineering/MigrationExecutor');
var dataMovement = require('./engineering/DataMovement');
var databaseBootstrapPlanner = require('./administration/DatabaseBootstrapPlanner');
var databaseBootstrapExecutor = require('./administration/DatabaseBootstrapExecutor');
var databaseServerDiscovery = require('./discovery/DatabaseServerDiscovery');
var databaseConfiguration = require('./administration/DatabaseConfiguration');
var databaseSecurityDiscovery = require('./discovery/DatabaseSecurityDiscovery');
var nativeJobDiscovery = require('./discovery/DatabaseNativeJobDiscovery');
var databaseConfigurationPlanner = require('./administration/DatabaseConfigurationPlanner');
var databaseConfigurationExecutor = require('./administration/DatabaseConfigurationExecutor');

var POSTGRES_METADATA_ALIASES = Object.freeze([
  'allowConnections', 'databaseName', 'schemaName', 'tableName', 'tableType',
  'columnName', 'ordinalPosition', 'columnDefault', 'isNullable', 'dataType',
  'nativeType', 'characterMaximumLength', 'numericPrecision', 'numericScale',
  'isIdentity', 'isGenerated', 'generationExpression', 'indexName', 'isUnique',
  'isPrimary', 'columnExpression', 'constraintName', 'referencedSchema',
  'referencedTable', 'referencedColumn', 'updateRule', 'deleteRule', 'matchOption',
  'constraintType'
]);

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
  var parameters = bindParameters(this._parameters(bindings), this.client.descriptor && this.client.descriptor.services);
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
  var parameters = bindParameters(this._parameters(bindings), this.client.descriptor && this.client.descriptor.services);
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

  var selected = connectionTargets.createTarget(adapter, this.config);
  this._target = selected.target;
  this._isPool = selected.isPool;
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
  var services = this.descriptor && this.descriptor.services;
  var operationOptions = operationOptionsForTypedValues(options, compiled.parameters, services);
  var parameters = bindParameters(compiled.parameters, services);
  if (this.dialect === 'sqlite') return target.query(compiled.text, parameters, operationOptions);
  if (parameters.length && typeof target.execute === 'function') return target.execute(compiled.text, parameters, operationOptions);
  if (parameters.length && typeof target.prepare === 'function') {
    var prepared = await target.prepare(compiled.text, operationOptions);
    try { return await prepared.execute(parameters, operationOptions); }
    finally { await prepared.close(); }
  }
  return target.query(compiled.text, operationOptions);
};

Client.prototype._executeTarget = async function _executeTarget(target, compiled, options) {
  var services = this.descriptor && this.descriptor.services;
  var operationOptions = operationOptionsForTypedValues(options, compiled.parameters, services);
  var parameters = bindParameters(compiled.parameters, services);
  if (this.dialect === 'sqlite') return target.run(compiled.text, parameters, operationOptions);
  if (typeof target.execute === 'function') return target.execute(compiled.text, parameters, operationOptions);
  if (typeof target.prepare === 'function') {
    var prepared = await target.prepare(compiled.text, operationOptions);
    try { return await prepared.execute(parameters, operationOptions); }
    finally { await prepared.close(); }
  }
  return target.query(compiled.text, operationOptions);
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
  var inferredOids = parameterTypeOids(compiled, this.descriptor && this.descriptor.services);
  if (inferredOids && prepareOptions.parameterTypeOids === undefined) prepareOptions.parameterTypeOids = inferredOids;
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

Client.prototype.transaction = function transaction(fn, options) {
  return transactionRunner.run(this, Client, fn, options);
};

Client.prototype.discoverSecurity = function discoverSecurity(options) {
  return databaseSecurityDiscovery.discover(this, options);
};

Client.prototype.discoverNativeJobs = function discoverNativeJobs(options) {
  return nativeJobDiscovery.discover(this, options);
};

Client.prototype.discoverConfiguration = function discoverConfiguration(options) {
  return databaseConfiguration.discover(this, options);
};

Client.prototype.planConfiguration = function planConfiguration(discovery, specification, options) {
  options = Object.assign({}, options || {}, { targetDialect: this.dialect });
  return databaseConfigurationPlanner.plan(discovery, specification, options);
};

Client.prototype.inspectConfigurationPlan = function inspectConfigurationPlan(plan, options) {
  return databaseConfigurationExecutor.inspect(this, plan, options);
};

Client.prototype.executeConfiguration = function executeConfiguration(plan, options) {
  return databaseConfigurationExecutor.run(this, plan, options);
};

Client.prototype.discoverServer = function discoverServer(options) {
  return databaseServerDiscovery.discover(this, options);
};

Client.prototype.assessBootstrapPrerequisites = function assessBootstrapPrerequisites(plan, options) {
  return databaseServerDiscovery.assessBootstrapPrerequisites(this, plan, options);
};

Client.prototype.planBootstrap = function planBootstrap(specification, options) {
  return databaseBootstrapPlanner.plan(specification, Object.assign({}, options || {}, { targetDialect: this.dialect }));
};

Client.prototype.inspectBootstrap = function inspectBootstrap(plan, options) {
  return databaseBootstrapExecutor.inspect(this, plan, options);
};

Client.prototype.executeBootstrap = function executeBootstrap(plan, options) {
  return databaseBootstrapExecutor.run(this, plan, options);
};

Client.prototype.executeMigration = function executeMigration(plan, options) {
  return migrationExecutor.run(this, plan, options);
};

Client.prototype.resumeMigration = function resumeMigration(plan, checkpoint, options) {
  return migrationExecutor.resume(this, plan, checkpoint, options);
};

Client.prototype.planDataMovementTo = function planDataMovementTo(targetClient, spec, options) {
  return dataMovement.plan(this, targetClient, spec, options);
};

Client.prototype.moveDataTo = function moveDataTo(targetClient, spec, options) {
  return dataMovement.run(this, targetClient, spec, options);
};

Client.prototype.resumeDataMovementTo = function resumeDataMovementTo(targetClient, spec, checkpoint, options) {
  return dataMovement.resume(this, targetClient, spec, checkpoint, options);
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
exports.parameterTypeOids = parameterTypeOids;
exports.parameterTypeOidsFromValues = parameterTypeOidsFromValues;
exports.bindParameters = bindParameters;
