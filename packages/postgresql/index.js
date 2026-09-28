'use strict';

var protocol = require('./lib/protocol');
var connectionModule = require('./lib/Connection');

var capabilities = Object.freeze({
  preparedStatements    : true,
  serverSideCursors     : false,
  savepoints            : false,
  catalogs              : true,
  schemas               : true,
  transactionalDdl      : true,
  queryCancellation     : false,
  changeDataCapture     : false,
  nativeJson            : true,
  multipleActiveResults : false
});

function quoteIdentifier(identifier) {
  if (typeof identifier !== 'string') throw new TypeError('PostgreSQL identifier must be a string');
  return '"' + identifier.replace(/"/g, '""') + '"';
}

function placeholder(index) {
  if (!Number.isInteger(index) || index < 1) throw new RangeError('PostgreSQL placeholder index must be a positive integer');
  return '$' + index;
}

var services = Object.freeze({ quoteIdentifier: quoteIdentifier, placeholder: placeholder });
var descriptor = Object.freeze({
  identity: Object.freeze({ family: 'postgresql', name: 'PostgreSQL' }),
  capabilities: capabilities,
  services: services,
  supports: function supports(capability) { return capabilities[capability] === true; }
});

function createObjectName(name) {
  if (!name || typeof name !== 'object') throw new TypeError('PostgreSQL object name must be an object');
  if (typeof name.name !== 'string' || name.name.length === 0) throw new TypeError('PostgreSQL object name requires a non-empty name');
  return Object.freeze({ catalog: name.catalog, schema: name.schema, name: name.name });
}

function createConnection(config) {
  return new connectionModule.Connection(config);
}

exports.descriptor = descriptor;
exports.capabilities = capabilities;
exports.services = services;
exports.createObjectName = createObjectName;
exports.protocol = protocol;
exports.Connection = connectionModule.Connection;
exports.PreparedStatement = connectionModule.PreparedStatement;
exports.PostgreSqlError = connectionModule.PostgreSqlError;
exports.createConnection = createConnection;
