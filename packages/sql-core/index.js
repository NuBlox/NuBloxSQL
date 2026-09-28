'use strict';

var DIALECT_FAMILIES = Object.freeze({
  MYSQL      : 'mysql',
  POSTGRESQL : 'postgresql',
  SQLITE     : 'sqlite',
  SQLSERVER  : 'sqlserver',
  ORACLE     : 'oracle'
});

var CAPABILITIES = Object.freeze({
  PREPARED_STATEMENTS       : 'preparedStatements',
  SERVER_SIDE_CURSORS       : 'serverSideCursors',
  SAVEPOINTS                : 'savepoints',
  CATALOGS                  : 'catalogs',
  SCHEMAS                   : 'schemas',
  TRANSACTIONAL_DDL         : 'transactionalDdl',
  QUERY_CANCELLATION        : 'queryCancellation',
  CHANGE_DATA_CAPTURE       : 'changeDataCapture',
  NATIVE_JSON               : 'nativeJson',
  MULTIPLE_ACTIVE_RESULTS   : 'multipleActiveResults'
});

function copyBooleanMap(input) {
  var output = Object.create(null);
  var source = input || {};

  Object.keys(source).forEach(function copyCapability(key) {
    if (typeof source[key] !== 'boolean') {
      throw new TypeError('SQL capability values must be boolean');
    }

    output[key] = source[key];
  });

  return Object.freeze(output);
}

function normalizeIdentity(identity) {
  if (!identity || typeof identity !== 'object') {
    throw new TypeError('SQL dialect identity must be an object');
  }

  if (typeof identity.family !== 'string' || identity.family.length === 0) {
    throw new TypeError('SQL dialect identity family must be a non-empty string');
  }

  if (typeof identity.name !== 'string' || identity.name.length === 0) {
    throw new TypeError('SQL dialect identity name must be a non-empty string');
  }

  return Object.freeze({
    family          : identity.family,
    name            : identity.name,
    serverVersion   : identity.serverVersion,
    protocolVersion : identity.protocolVersion
  });
}

function assertDialectServices(services) {
  if (!services || typeof services !== 'object') {
    throw new TypeError('SQL dialect services must be an object');
  }

  if (typeof services.quoteIdentifier !== 'function') {
    throw new TypeError('SQL dialect services require quoteIdentifier()');
  }

  if (typeof services.placeholder !== 'function') {
    throw new TypeError('SQL dialect services require placeholder()');
  }

  return services;
}

function createDialectDescriptor(options) {
  if (!options || typeof options !== 'object') {
    throw new TypeError('SQL dialect descriptor options must be an object');
  }

  var identity = normalizeIdentity(options.identity);
  var capabilities = copyBooleanMap(options.capabilities);
  var services = assertDialectServices(options.services);

  var descriptor = {
    identity     : identity,
    capabilities : capabilities,
    services     : services,
    supports     : function supports(capability) {
      return capabilities[capability] === true;
    }
  };

  return Object.freeze(descriptor);
}

function assertDialectDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== 'object') {
    throw new TypeError('SQL dialect descriptor must be an object');
  }

  normalizeIdentity(descriptor.identity);
  copyBooleanMap(descriptor.capabilities);
  assertDialectServices(descriptor.services);

  if (typeof descriptor.supports !== 'function') {
    throw new TypeError('SQL dialect descriptor requires supports()');
  }

  return descriptor;
}

function createObjectName(name) {
  if (!name || typeof name !== 'object') {
    throw new TypeError('SQL object name must be an object');
  }

  if (typeof name.name !== 'string' || name.name.length === 0) {
    throw new TypeError('SQL object name requires a non-empty name');
  }

  return Object.freeze({
    catalog : name.catalog,
    schema  : name.schema,
    name    : name.name
  });
}

exports.DIALECT_FAMILIES = DIALECT_FAMILIES;
exports.CAPABILITIES = CAPABILITIES;
exports.createDialectDescriptor = createDialectDescriptor;
exports.assertDialectDescriptor = assertDialectDescriptor;
exports.createObjectName = createObjectName;
