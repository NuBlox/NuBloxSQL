'use strict';

var clientApi = require('./lib/client/Client');
var sqlApi = require('./lib/client/Sql');
var errorApi = require('./lib/client/Error');
var publicErrorApi = require('./lib/client/PublicError');
var streamApi = require('./lib/client/Stream');
var metadataApi = require('./lib/client/Metadata');
var observabilityApi = require('./lib/client/Observability');
var typesApi = require('./lib/client/Types');
var connectionUrlApi = require('./lib/client/ConnectionUrl');
var lifecycleApi = require('./lib/client/LifecycleIntegration');
var configurationApi = require('./lib/client/Configuration');
var capabilitiesApi = require('./lib/client/Capabilities');
var capabilityModelApi = require('./lib/capabilities');
var metadataIntegrationApi = require('./lib/client/MetadataIntegration');
var transactionPolicyApi = require('./lib/client/TransactionPolicy');
var diagnosticsApi = require('./lib/client/Diagnostics');
streamApi.install(clientApi);
require('./lib/client/SqlServerStreamIntegration').install(streamApi);
diagnosticsApi.install(clientApi);
require('./lib/client/OperationControlIntegration').install(clientApi);
require('./lib/client/ErrorIntegration').install(clientApi);
observabilityApi.install(clientApi, streamApi);
require('./lib/client/TypesIntegration').install(clientApi, streamApi);
require('./lib/client/TransactionIntegration').install(clientApi);
require('./lib/client/SqlServerMetadataIntegration').install(metadataApi);
require('./lib/client/SQLiteAdvancedMetadataIntegration').install(metadataApi);
metadataIntegrationApi.install(clientApi, metadataApi);
lifecycleApi.install(clientApi);
capabilitiesApi.install(clientApi);
observabilityApi.install(clientApi, streamApi);

var DIALECTS = Object.freeze({ mysql: 'mysql', postgresql: 'postgresql', sqlite: 'sqlite', sqlserver: 'sqlserver' });
var loaders = Object.freeze({
  mysql: function () { return require('./lib/dialects/mysql'); },
  postgresql: function () { return require('./lib/dialects/postgresql'); },
  sqlite: function () { return require('./lib/dialects/sqlite'); },
  sqlserver: function () { return require('./lib/dialects/sqlserver'); }
});
var cache = Object.create(null);

function normalizeDialect(value) {
  if (typeof value !== 'string' || value.trim().length === 0) throw publicErrorApi.routingError('NuBloxSQL requires a dialect: mysql, postgresql, sqlite or sqlserver');
  var dialect = value.trim().toLowerCase();
  if (dialect === 'postgres' || dialect === 'pg') dialect = 'postgresql';
  if (dialect === 'mssql' || dialect === 'sql-server') dialect = 'sqlserver';
  if (!Object.prototype.hasOwnProperty.call(loaders, dialect)) throw publicErrorApi.unsupportedDialectError(value);
  return dialect;
}
function loadAdapter(dialect) { var normalized = normalizeDialect(dialect); if (!cache[normalized]) cache[normalized] = loaders[normalized](); return cache[normalized]; }
function copyConfig(source, target, excluded) { Object.keys(source || {}).forEach(function (key) { if (!excluded || excluded.indexOf(key) === -1) target[key] = source[key]; }); return target; }

function resolveInvocation(dialectOrConfig, maybeConfig) {
  var dialect, config, parsed;
  if (connectionUrlApi.isUrlLike(dialectOrConfig)) {
    parsed = connectionUrlApi.parse(dialectOrConfig); dialect = parsed.dialect; config = copyConfig(maybeConfig || {}, copyConfig(parsed.config, {}));
  } else if (typeof dialectOrConfig === 'string') {
    dialect = normalizeDialect(dialectOrConfig); config = maybeConfig || {};
  } else {
    config = dialectOrConfig || {};
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw publicErrorApi.configurationError('connection configuration must be an object');
    if (config.url !== undefined) {
      parsed = connectionUrlApi.parse(config.url);
      if (config.dialect !== undefined && normalizeDialect(config.dialect) !== parsed.dialect) throw publicErrorApi.routingError('NuBloxSQL connection URL dialect does not match explicit dialect: ' + config.dialect, { dialect: normalizeDialect(config.dialect) });
      dialect = parsed.dialect; config = copyConfig(config, copyConfig(parsed.config, {}), ['dialect', 'url']);
    } else dialect = normalizeDialect(config.dialect);
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw publicErrorApi.configurationError('connection configuration must be an object', dialect);
  var adapterConfig = {};
  Object.keys(config).forEach(function (key) { if (key !== 'dialect' && key !== 'url') adapterConfig[key] = config[key]; });
  return { dialect: dialect, adapter: loadAdapter(dialect), config: adapterConfig };
}

function adapter(dialect) { return loadAdapter(dialect); }
function createConnection(dialectOrConfig, maybeConfig) { var invocation = resolveInvocation(dialectOrConfig, maybeConfig); configurationApi.validateConnectionConfig(invocation.dialect, invocation.config); return invocation.adapter.createConnection(invocation.config); }
function createPool(dialectOrConfig, maybeConfig) { var invocation = resolveInvocation(dialectOrConfig, maybeConfig); if (typeof invocation.adapter.createPool !== 'function') throw errorApi.unsupportedError(invocation.dialect, 'connection pools'); configurationApi.validatePoolConfig(invocation.dialect, invocation.config); return invocation.adapter.createPool(invocation.config); }
function hideClientOption(config, name, validate) { var value = config[name]; if (value === undefined) return; if (validate) validate(value); Object.defineProperty(config, name, { value: value, enumerable: false, configurable: false, writable: false }); }
function createClient(dialectOrConfig, maybeConfig) {
  var invocation = resolveInvocation(dialectOrConfig, maybeConfig);
  hideClientOption(invocation.config, 'telemetry', function (telemetry) { if (telemetry === null || typeof telemetry !== 'object' || Array.isArray(telemetry)) throw publicErrorApi.configurationError('telemetry must be an options object', invocation.dialect); });
  hideClientOption(invocation.config, 'types', function (types) { if (types === null || typeof types !== 'object' || Array.isArray(types)) throw publicErrorApi.configurationError('types must be an options object', invocation.dialect); });
  configurationApi.validateClientConfig(invocation.dialect, invocation.config, typeof invocation.adapter.createPool === 'function');
  return new clientApi.Client(invocation.adapter, invocation.dialect, invocation.config);
}
async function introspect(dialectOrConfig, maybeConfig, maybeOptions) {
  var client, options;
  if (typeof dialectOrConfig === 'string' && !connectionUrlApi.isUrlLike(dialectOrConfig)) { client = createClient(dialectOrConfig, maybeConfig); options = maybeOptions || {}; }
  else { client = createClient(dialectOrConfig); options = maybeConfig || {}; }
  try { return await client.introspect(options); }
  finally { await client.close(); }
}
function supports(dialect, capability) { var implementation = loadAdapter(dialect); var dialectDescriptor = implementation.descriptor; return !!(dialectDescriptor && typeof dialectDescriptor.supports === 'function' && dialectDescriptor.supports(capability)); }
function descriptor(dialect) { var implementation = loadAdapter(dialect); return implementation.descriptor || null; }
function capabilityReport(dialect) { var normalized = normalizeDialect(dialect); var implementation = loadAdapter(normalized); return capabilitiesApi.buildReport(normalized, implementation.descriptor || null, null, false); }
function transactionPolicy(dialect) { var normalized = normalizeDialect(dialect); var implementation = loadAdapter(normalized); return transactionPolicyApi.describe(normalized, implementation.descriptor || null); }
function defineLazy(target, name, loader) { Object.defineProperty(target, name, { enumerable: true, configurable: false, get: loader }); }

var dialects = {};
defineLazy(dialects, 'mysql', function () { return loadAdapter('mysql'); });
defineLazy(dialects, 'postgresql', function () { return loadAdapter('postgresql'); });
defineLazy(dialects, 'sqlite', function () { return loadAdapter('sqlite'); });
defineLazy(dialects, 'sqlserver', function () { return loadAdapter('sqlserver'); });
Object.freeze(dialects);

exports.DIALECTS = DIALECTS;
exports.CLIENT_LIFECYCLE_STATES = lifecycleApi.STATES;
exports.TRANSACTION_ISOLATION_LEVELS = transactionPolicyApi.ISOLATION_LEVELS;
exports.SQLITE_TRANSACTION_MODES = transactionPolicyApi.SQLITE_MODES;
exports.OBSERVABILITY_SCHEMA_VERSION = observabilityApi.EVENT_SCHEMA_VERSION;
exports.OBSERVABILITY_EVENT_TYPES = observabilityApi.EVENT_TYPES;
exports.QUERY_DIAGNOSTICS_SCHEMA_VERSION = diagnosticsApi.SCHEMA_VERSION;
exports.ERROR_CODES = publicErrorApi.CODES;
exports.SQL_CAPABILITY_MODEL_SCHEMA_VERSION = capabilityModelApi.api.schemaVersion;
exports.SQL_CAPABILITY_ONTOLOGY_SCHEMA_VERSION = capabilityModelApi.api.ontology.schemaVersion;
exports.PRODUCT_COVERAGE_SCHEMA_VERSION = capabilityModelApi.api.productCoverage.SCHEMA_VERSION;
exports.TIER1_DIALECTS = capabilityModelApi.api.tier1Dialects;
exports.SQL_CAPABILITY_CATEGORIES = capabilityModelApi.api.categories;
exports.SQL_CAPABILITY_SUPPORT_LEVELS = capabilityModelApi.api.supportLevels;
exports.capabilityModel = capabilityModelApi.api;
exports.capabilityOntology = capabilityModelApi.api.ontology;
exports.productCoverage = capabilityModelApi.api.productCoverage;
exports.dialects = dialects;
exports.adapter = adapter;
exports.descriptor = descriptor;
exports.supports = supports;
exports.capabilityReport = capabilityReport;
exports.transactionPolicy = transactionPolicy;
exports.createConnection = createConnection;
exports.createPool = createPool;
exports.createClient = createClient;
exports.introspect = introspect;
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
