'use strict';

var typedValues = require('../../core/TypedValue');
var runtime = require('./lib/Connection');
var maintenanceIntegration = require('./lib/MaintenanceIntegration');
var extensibilityIntegration = require('./lib/ExtensibilityIntegration');

maintenanceIntegration.install(runtime.Connection);
extensibilityIntegration.install(runtime);

var capabilities = Object.freeze({
  preparedStatements    : true,
  serverSideCursors     : false,
  savepoints            : true,
  transactions          : true,
  transactionIsolation : false,
  readOnlyTransactions  : false,
  deferrableTransactions: false,
  nestedTransactions    : true,
  catalogs              : false,
  schemas               : false,
  transactionalDdl      : true,
  queryCancellation     : false,
  changeDataCapture     : false,
  nativeJson            : false,
  multipleActiveResults : false
});

function quoteIdentifier(identifier) {
  if (typeof identifier !== 'string') throw new TypeError('SQLite identifier must be a string');
  return '"' + identifier.replace(/"/g, '""') + '"';
}

function placeholder(index) {
  if (!Number.isInteger(index) || index < 1) throw new RangeError('SQLite placeholder index must be a positive integer');
  return '?';
}

function bindParameter(value) {
  return typedValues.unwrap(value);
}

var services = Object.freeze({ quoteIdentifier: quoteIdentifier, placeholder: placeholder, bindParameter: bindParameter });
var descriptor = Object.freeze({
  identity: Object.freeze({ family: 'sqlite', name: 'SQLite' }),
  capabilities: capabilities,
  services: services,
  supports: function supports(capability) { return capabilities[capability] === true; }
});

function createObjectName(name) {
  if (!name || typeof name !== 'object') throw new TypeError('SQLite object name must be an object');
  if (typeof name.name !== 'string' || name.name.length === 0) throw new TypeError('SQLite object name requires a non-empty name');
  return Object.freeze({ catalog: name.catalog, schema: name.schema, name: name.name });
}

function createConnection(config) {
  return new runtime.Connection(config);
}

exports.descriptor = descriptor;
exports.capabilities = capabilities;
exports.services = services;
exports.createObjectName = createObjectName;
exports.Connection = runtime.Connection;
exports.PreparedStatement = runtime.PreparedStatement;
exports.SqliteError = runtime.SqliteError;
exports.SqliteResultLimitError = runtime.SqliteResultLimitError;
exports.createConnection = createConnection;
