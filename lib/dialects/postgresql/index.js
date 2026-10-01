'use strict';

var typedValues = require('../../core/TypedValue');
var protocol = require('./lib/protocol');
var connectionModule = require('./lib/DiagnosticsConnection');
var poolModule = require('./lib/DiagnosticsPool');

var capabilities = Object.freeze({
  preparedStatements    : true,
  serverSideCursors     : true,
  savepoints            : true,
  transactions          : true,
  transactionIsolation : true,
  readOnlyTransactions  : true,
  deferrableTransactions: true,
  nestedTransactions    : true,
  catalogs              : true,
  schemas               : true,
  transactionalDdl      : true,
  queryCancellation     : true,
  asynchronousNotifications: true,
  queryDiagnostics      : true,
  changeDataCapture     : false,
  nativeJson            : true,
  copyStreaming         : true,
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

function parameterTypeOid(spec) {
  if (!spec || typeof spec !== 'object') throw new TypeError('PostgreSQL typed bind requires a normalized type specification');
  if (spec.type === 'decimal') return 1700;
  if (spec.type === 'uuid') return 2950;
  if (spec.type === 'date') return 1082;
  if (spec.type === 'time') return 1083;
  if (spec.type === 'timestamp') return 1114;
  throw new RangeError('PostgreSQL does not map portable bind type "' + spec.type + '"');
}

function bindParameter(value) {
  return typedValues.unwrap(value);
}

var services = Object.freeze({
  quoteIdentifier: quoteIdentifier,
  placeholder: placeholder,
  parameterTypeOid: parameterTypeOid,
  bindParameter: bindParameter
});
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

function createConnection(config) { return new connectionModule.Connection(config); }
function createPool(config) { return new poolModule.Pool(config); }

exports.descriptor = descriptor;
exports.capabilities = capabilities;
exports.services = services;
exports.createObjectName = createObjectName;
exports.protocol = protocol;
exports.Connection = connectionModule.Connection;
exports.PreparedStatement = connectionModule.PreparedStatement;
exports.PortalCursor = connectionModule.PortalCursor;
exports.Pool = poolModule.Pool;
exports.NotificationSubscription = poolModule.NotificationSubscription;
exports.PostgreSqlError = connectionModule.PostgreSqlError;
exports.PostgreSqlCancellationError = connectionModule.PostgreSqlCancellationError;
exports.PostgreSqlResultLimitError = connectionModule.PostgreSqlResultLimitError;
exports.DEFAULT_RESULT_LIMITS = connectionModule.DEFAULT_RESULT_LIMITS;
exports.DEFAULT_COPY_BUFFER_BYTES = connectionModule.DEFAULT_COPY_BUFFER_BYTES;
exports.createConnection = createConnection;
exports.createPool = createPool;
