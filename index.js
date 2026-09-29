'use strict';

var DIALECTS = Object.freeze({
  mysql: 'mysql',
  postgresql: 'postgresql',
  sqlite: 'sqlite'
});

var loaders = Object.freeze({
  mysql: function loadMySql() { return require('./packages/mysql'); },
  postgresql: function loadPostgreSql() { return require('./packages/postgresql'); },
  sqlite: function loadSqlite() { return require('./packages/sqlite'); }
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
    throw new Error('NuBloxSQL dialect "' + invocation.dialect + '" does not support connection pools');
  }

  return invocation.adapter.createPool(invocation.config);
}

function supports(dialect, capability) {
  var implementation = loadAdapter(dialect);
  var dialectDescriptor = implementation.descriptor;

  if (!dialectDescriptor && normalizeDialect(dialect) === 'mysql') {
    dialectDescriptor = require('./packages/mysql/lib/SqlDialectDescriptor');
  }

  return !!(dialectDescriptor && typeof dialectDescriptor.supports === 'function' && dialectDescriptor.supports(capability));
}

function descriptor(dialect) {
  var normalized = normalizeDialect(dialect);
  var implementation = loadAdapter(normalized);
  if (implementation.descriptor) return implementation.descriptor;
  if (normalized === 'mysql') return require('./packages/mysql/lib/SqlDialectDescriptor');
  return null;
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

defineLazy(exports, 'sqlCore', function () { return require('./packages/sql-core'); });
defineLazy(exports, 'mysql', function () { return loadAdapter('mysql'); });
defineLazy(exports, 'postgresql', function () { return loadAdapter('postgresql'); });
defineLazy(exports, 'sqlite', function () { return loadAdapter('sqlite'); });
