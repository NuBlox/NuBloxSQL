'use strict';

var errorApi = require('./Error');

var CODES = Object.freeze({
  CONFIGURATION: 'NUBLOXSQL_CONFIGURATION',
  ROUTING: 'NUBLOXSQL_ROUTING',
  UNSUPPORTED_DIALECT: 'NUBLOXSQL_UNSUPPORTED_DIALECT',
  UNSUPPORTED_URL_SCHEME: 'NUBLOXSQL_UNSUPPORTED_URL_SCHEME',
  CLIENT_LIFECYCLE: 'NUBLOXSQL_CLIENT_LIFECYCLE',
  UNSUPPORTED: 'NUBLOXSQL_UNSUPPORTED'
});

function create(message, details) {
  details = details || {};
  return new errorApi.NuBloxSqlError(message, {
    code: details.code,
    category: details.category || errorApi.CATEGORIES.STATE,
    dialect: details.dialect || null,
    operation: details.operation || null,
    retryable: false,
    native: details.native || null,
    cause: details.cause
  });
}

function configurationError(message, dialect, cause) {
  return create('NuBloxSQL configuration: ' + message, {
    code: CODES.CONFIGURATION,
    category: errorApi.CATEGORIES.STATE,
    dialect: dialect || null,
    operation: 'configuration',
    cause: cause
  });
}

function routingError(message, details) {
  details = details || {};
  return create(message, {
    code: details.code || CODES.ROUTING,
    category: details.category || errorApi.CATEGORIES.STATE,
    dialect: details.dialect || null,
    operation: 'routing',
    cause: details.cause
  });
}

function unsupportedDialectError(value) {
  return routingError('Unsupported NuBloxSQL dialect: ' + value, {
    code: CODES.UNSUPPORTED_DIALECT,
    category: errorApi.CATEGORIES.UNSUPPORTED
  });
}

function unsupportedUrlSchemeError(scheme) {
  return routingError('Unsupported NuBloxSQL connection URL scheme: ' + scheme, {
    code: CODES.UNSUPPORTED_URL_SCHEME,
    category: errorApi.CATEGORIES.UNSUPPORTED
  });
}

function lifecycleError(action, state, dialect) {
  var error = create('NuBloxSQL client cannot ' + action + ' while lifecycle state is ' + state, {
    code: CODES.CLIENT_LIFECYCLE,
    category: errorApi.CATEGORIES.STATE,
    dialect: dialect || null,
    operation: 'lifecycle'
  });
  error.lifecycleState = state;
  return error;
}

exports.CODES = CODES;
exports.create = create;
exports.configurationError = configurationError;
exports.routingError = routingError;
exports.unsupportedDialectError = unsupportedDialectError;
exports.unsupportedUrlSchemeError = unsupportedUrlSchemeError;
exports.lifecycleError = lifecycleError;
