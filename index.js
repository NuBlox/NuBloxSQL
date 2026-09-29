'use strict';

var sqlCore = require('./packages/sql-core');
var mysql = require('./packages/mysql');
var postgresql = require('./packages/postgresql');
var sqlite = require('./packages/sqlite');

var DIALECTS = Object.freeze({
  mysql: 'mysql',
  postgresql: 'postgresql',
  sqlite: 'sqlite'
});

var adapters = Object.freeze({
  mysql: mysql,
  postgresql: postgresql,
  sqlite: sqlite
});

function normalizeDialect(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError('NuBloxSQL requires a dialect: mysql, postgresql or sqlite');
  }

  var dialect = value.trim().toLowerCase();
  if (dialect === 'postgres' || dialect === 'pg') dialect = 'postgresql';

  if (!Object.prototype.hasOwnProperty.call(adapters, dialect)) {
    throw new RangeError('Unsupported NuBloxSQL dialect: ' + value);
  }

  return dialect;
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

  return { dialect: dialect, adapter: adapters[dialect], config: adapterConfig };
}

function adapter(dialect) {
  return adapters[normalizeDialect(dialect)];
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
  var implementation = adapter(dialect);
  if (implementation.descriptor && typeof implementation.descriptor.supports === 'function') {
    return implementation.descriptor.supports(capability);
  }

  if (dialect === 'mysql') {
    return require('./packages/mysql/lib/SqlDialectDescriptor').supports(capability);
  }

  return false;
}

function descriptor(dialect) {
  var normalized = normalizeDialect(dialect);
  var implementation = adapters[normalized];
  if (implementation.descriptor) return implementation.descriptor;
  if (normalized === 'mysql') return require('./packages/mysql/lib/SqlDialectDescriptor');
  return null;
}

exports.DIALECTS = DIALECTS;
exports.sqlCore = sqlCore;
exports.dialects = adapters;
exports.adapter = adapter;
exports.descriptor = descriptor;
exports.supports = supports;
exports.createConnection = createConnection;
exports.createPool = createPool;

// Advanced/native access remains available from the same installation.
exports.mysql = mysql;
exports.postgresql = postgresql;
exports.sqlite = sqlite;
