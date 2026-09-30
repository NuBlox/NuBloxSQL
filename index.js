'use strict';

var clientApi = require('./lib/client/Client');
var sqlApi = require('./lib/client/Sql');
var errorApi = require('./lib/client/Error');
var streamApi = require('./lib/client/Stream');
var metadataApi = require('./lib/client/Metadata');
var observabilityApi = require('./lib/client/Observability');
var typesApi = require('./lib/client/Types');
var connectionUrlApi = require('./lib/client/ConnectionUrl');
var lifecycleApi = require('./lib/client/LifecycleIntegration');
var configurationApi = require('./lib/client/Configuration');
streamApi.install(clientApi);
require('./lib/client/SqlServerStreamIntegration').install(streamApi);
require('./lib/client/OperationControlIntegration').install(clientApi);
require('./lib/client/ErrorIntegration').install(clientApi);
observabilityApi.install(clientApi, streamApi);
require('./lib/client/TypesIntegration').install(clientApi, streamApi);
require('./lib/client/TransactionIntegration').install(clientApi);
require('./lib/client/SqlServerMetadataIntegration').install(metadataApi);
lifecycleApi.install(clientApi);

var DIALECTS = Object.freeze({
  mysql: 'mysql',
  postgresql: 'postgresql',
  sqlite: 'sqlite',
  sqlserver: 'sqlserver'
});

var loaders = Object.freeze({
  mysql: function loadMySql() { return require('./lib/dialects/mysql'); },
  postgresql: function loadPostgreSql() { return require('./lib/dialects/postgresql'); },
  sqlite: function loadSqlite() { return require('./lib/dialects/sqlite'); },
  sqlserver: function loadSqlServer() { return require('./lib/dialects/sqlserver'); }
});

var cache = Object.create(null);

function normalizeDialect(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError('NuBloxSQL requires a dialect: mysql, postgresql, sqlite or sqlserver');
  }
  var dialect = value.trim().toLowerCase();
  if (dialect === 'postgres' || dialect === 'pg') dialect = 'postgresql';
  if (dialect === 'mssql' || dialect === 'sql-server') dialect = 'sqlserver';
  if (!Object.prototype.hasOwnProperty.call(loaders, dialect)) throw new RangeError('Unsupported NuBloxSQL dialect: ' + value);
  return dialect;
}

function loadAdapter(dialect) {
  var normalized = normalizeDialect(dialect);
  if (!cache[normalized]) cache[normalized] = loaders[normalized]();
  return cache[normalized];
}

function copyConfig(source, target, excluded) {
  Object.keys(source || {}).forEach(function copyConfigKey(key) {
    if (!excluded || excluded.indexOf(key) === -1) target[key] = source[key];
  });
  return target;
}

function resolveInvocation(dialectOrConfig, maybeConfig) {
  var dialect;
  var config;
  var parsed;

  if (connectionUrlApi.isUrlLike(dialectOrConfig)) {
    parsed = connectionUrlApi.parse(dialectOrConfig);
    dialect = parsed.dialect;
    config = copyConfig(maybeConfig || {}, copyConfig(parsed.config, {}));
  } else if (typeof dialectOrConfig === 'string') {
    dialect = normalizeDialect(dialectOrConfig);
    config = maybeConfig || {};
  } else {
    config = dialectOrConfig || {};
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new TypeError('NuBloxSQL connection configuration must be an object');

    if (config.url !== undefined) {
      parsed = connectionUrlApi.parse(config.url);
      if (config.dialect !== undefined && normalizeDialect(config.dialect) !== parsed.dialect) {
        throw new RangeError('NuBloxSQL connection URL dialect does not match explicit dialect: ' + config.dialect);
      }
      dialect = parsed.dialect;
      config = copyConfig(config, copyConfig(parsed.config, {}), ['dialect', 'url']);
    } else {
      dialect = normalizeDialect(config.dialect);
    }
  }

  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new TypeError('NuBloxSQL connection configuration must be an object');

  var adapterConfig = {};
  Object.keys(config).forEach(function copyAdapterConfig(key) {
    if (key !== 'dialect' && key !== 'url') adapterConfig[key] = config[key];
  });
  return { dialect: dialect, adapter: loadAdapter(dialect), config: adapterConfig };
}

function adapter(dialect) { return loadAdapter(dialect); }

function createConnection(dialectOrConfig, maybeConfig) {
  var invocation = resolveInvocation(dialectOrConfig, maybeConfig);
  configurationApi.validateConnectionConfig(invocation.dialect, invocation.config);
  return invocation.adapter.createConnection(invocation.config);
}

function createPool(dialectOrConfig, maybeConfig) {
  var invocation = resolveInvocation(dialectOrConfig, maybeConfig);
  if (typeof invocation.adapter.createPool !== 'function') throw errorApi.unsupportedError(invocation.dialect, 'connection pools');
  configurationApi.validatePoolConfig(invocation.dialect, invocation.config);
  return invocation.adapter.createPool(invocation.config);
}

function hideClientOption(config, name, validate) {
  var value = config[name];
  if (value === undefined) return;
  if (validate) validate(value);
  Object.defineProperty(config, name, {
    value: value,
    enumerable: false,
    configurable: false,
    writable: false
  });
}

function createClient(dialectOrConfig, maybeConfig) {
  var invocation = resolveInvocation(dialectOrConfig, maybeConfig);
  hideClientOption(invocation.config, 'telemetry', function (telemetry) {
    if (telemetry === null || typeof telemetry !== 'object' || Array.isArray(telemetry)) throw new TypeError('NuBloxSQL telemetry must be an options object');
  });
  hideClientOption(invocation.config, 'types', function (types) {
    if (types === null || typeof types !== 'object' || Array.isArray(types)) throw new TypeError('NuBloxSQL types must be an options object');
  });
  configurationApi.validateClientConfig(invocation.dialect, invocation.config, typeof invocation.adapter.createPool === 'function');
  return new clientApi.Client(invocation.adapter, invocation.dialect, invocation.config);
}

function supports(dialect, capability) {
  var implementation = loadAdapter(dialect);
  var dialectDescriptor = implementation.descriptor;
  return !!(dialectDescriptor && typeof dialectDescriptor.supports === 'function' && dialectDescriptor.supports(capability));
}

function descriptor(dialect) {
  var implementation = loadAdapter(dialect);
  return implementation.descriptor || null;
}

function defineLazy(target, name, loader) {
  Object.defineProperty(target, name, { enumerable: true, configurable: false, get: loader });
}

var dialects = {};
defineLazy(dialects, 'mysql', function () { return loadAdapter('mysql'); });
defineLazy(dialects, 'postgresql', function () { return loadAdapter('postgresql'); });
defineLazy(dialects, 'sqlite', function () { return loadAdapter('sqlite'); });
defineLazy(dialects, 'sqlserver', function () { return loadAdapter('sqlserver'); });
Object.freeze(dialects);

exports.DIALECTS = DIALECTS;
exports.CLIENT_LIFECYCLE_STATES = lifecycleApi.STATES;
exports.dialects = dialects;
exports.adapter = adapter;
exports.descriptor = descriptor;
exports.supports = supports;
exports.createConnection = createConnection;
exports.createPool = createPool;
exports.createClient = createClient;
exports.sql = sqlApi.sql;
exports.Client = clientApi.Client;
exports.ClientRowStream = streamApi.ClientRowStream;
exports.MetadataCatalog = metadataApi.Metadata;
exports.NuBloxSqlError = errorApi.NuBloxSqlError;
exports.ERROR_CATEGORIES = errorApi.CATEGORIES;
exports.Observer = observabilityApi.Observer;
exports.TypeRegistry = typesApi.TypeRegistry;

defineLazy(exports, 'sqlCore', function () { return require('./lib/core'); });
defineLazy(exports, 'mysql', function () { return loadAdapter('mysql'); });
defineLazy(exports, 'postgresql', function () { return loadAdapter('postgresql'); });
defineLazy(exports, 'sqlite', function () { return loadAdapter('sqlite'); });
defineLazy(exports, 'sqlserver', function () { return loadAdapter('sqlserver'); });
