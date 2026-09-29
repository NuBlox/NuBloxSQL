'use strict';

var clientApi = require('./lib/client/Client');
var sqlApi = require('./lib/client/Sql');
var errorApi = require('./lib/client/Error');
var streamApi = require('./lib/client/Stream');
streamApi.install(clientApi);
require('./lib/client/ErrorIntegration').install(clientApi);

var DIALECTS = Object.freeze({
  mysql: 'mysql',
  postgresql: 'postgresql',
  sqlite: 'sqlite'
});

var loaders = Object.freeze({
  mysql: function loadMySql() { return require('./lib/dialects/mysql'); },
  postgresql: function loadPostgreSql() { return require('./lib/dialects/postgresql'); },
  sqlite: function loadSqlite() { return require('./lib/dialects/sqlite'); }
});

var cache = Object.create(null);

function normalizeDialect(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError('NuBloxSQL requires a dialect: mysql, postgresql or sqlite');
  }

  var dialect = value.trim().toLowerCase();
  if (dialect === 'postgres' || dialect === 'pg') dialect = 'postgresql';

  if (!Object.prototype.hasOwnProperty.call(loaders, dialect)) {
    throw new RangeError('Unsupported NuBloxSQL dialect: ' + value);
  }

  return dialect;
}

function loadAdapter(dialect) {
  var normalized = normalizeDialect(dialect);
  if (!cache[normalized]) cache[normalized] = loaders[normalized]();
  return cache[normalized];
}

function resolveInvocation(dialectOrConfig, maybeConfig) {
  var dialect;
  var config;

  if (typeof dialectOrConfig === 'string') {
    dialect = normalizeDialect(dialectOrConfig);
    config = maybeConfig || {};
  } else {
    config = dialectOrConfig || {};
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new TypeError('NuBloxSQL connection configuration must be an object');
    }
    dialect = normalizeDialect(config.dialect);
  }

  var adapterConfig = {};
  Object.keys(config).forEach(function copyConfig(key) {
    if (key !== 'dialect') adapterConfig[key] = config[key];
  });

  return { dialect: dialect, adapter: loadAdapter(dialect), config: adapterConfig };
}

function adapter(dialect) {
  return loadAdapter(dialect);
}

function createConnection(dialectOrConfig, maybeConfig) {
  var invocation = resolveInvocation(dialectOrConfig, maybeConfig);
  return invocation.adapter.createConnection(invocation.config);
}

function createPool(dialectOrConfig, maybeConfig) {
  var invocation = resolveInvocation(dialectOrConfig, maybeConfig);

  if (typeof invocation.adapter.createPool !== 'function') {
    throw errorApi.unsupportedError(invocation.dialect, 'connection pools');
  }

  return invocation.adapter.createPool(invocation.config);
}

function createClient(dialectOrConfig, maybeConfig) {
  var invocation = resolveInvocation(dialectOrConfig, maybeConfig);
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
  Object.defineProperty(target, name, {
    enumerable: true,
    configurable: false,
    get: loader
  });
}

var dialects = {};
defineLazy(dialects, 'mysql', function () { return loadAdapter('mysql'); });
defineLazy(dialects, 'postgresql', function () { return loadAdapter('postgresql'); });
defineLazy(dialects, 'sqlite', function () { return loadAdapter('sqlite'); });
Object.freeze(dialects);

exports.DIALECTS = DIALECTS;
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
exports.NuBloxSqlError = errorApi.NuBloxSqlError;
exports.ERROR_CATEGORIES = errorApi.CATEGORIES;

defineLazy(exports, 'sqlCore', function () { return require('./lib/core'); });
defineLazy(exports, 'mysql', function () { return loadAdapter('mysql'); });
defineLazy(exports, 'postgresql', function () { return loadAdapter('postgresql'); });
defineLazy(exports, 'sqlite', function () { return loadAdapter('sqlite'); });
