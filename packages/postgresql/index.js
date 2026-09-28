'use strict';

var protocol = require('./lib/protocol');
var connectionModule = require('./lib/Connection');

var capabilities = Object.freeze({
  preparedStatements    : true,
  serverSideCursors     : true,
  savepoints            : true,
  catalogs              : true,
  schemas               : true,
  transactionalDdl      : true,
  queryCancellation     : true,
  changeDataCapture     : true,
  nativeJson            : true,
  multipleActiveResults : false
});

function capability(name, level, options) {
  options = options || {};
  return Object.freeze({
    name: name,
    level: level,
    since: options.since,
    until: options.until,
    requires: options.requires ? Object.freeze(options.requires.slice()) : undefined,
    notes: options.notes,
    extension: options.extension
  });
}

var capabilityProfile = Object.freeze({
  connectionPooling: capability('connectionPooling', 'conditional', {notes: 'Provided by higher-level pool implementation rather than the PostgreSQL wire protocol'}),
  tls: capability('tls', 'native'),
  mutualTls: capability('mutualTls', 'conditional', {requires: ['client-certificate']}),
  preparedStatements: capability('preparedStatements', 'native'),
  serverPreparedStatements: capability('serverPreparedStatements', 'native'),
  namedParameters: capability('namedParameters', 'unsupported', {notes: 'Native protocol parameters are positional'}),
  positionalParameters: capability('positionalParameters', 'native'),
  binaryProtocol: capability('binaryProtocol', 'native'),
  serverSideCursors: capability('serverSideCursors', 'native', {notes: 'Portal/cursor semantics'}),
  streamingResults: capability('streamingResults', 'conditional', {notes: 'Depends on extended-query/cursor execution path'}),
  queryCancellation: capability('queryCancellation', 'native'),
  queryTimeout: capability('queryTimeout', 'native'),
  multiStatement: capability('multiStatement', 'native'),
  multiResult: capability('multiResult', 'native'),
  multipleActiveResults: capability('multipleActiveResults', 'unsupported', {notes: 'A single PostgreSQL connection is protocol-serialised'}),
  savepoints: capability('savepoints', 'native'),
  transactionIsolation: capability('transactionIsolation', 'native'),
  readOnlyTransactions: capability('readOnlyTransactions', 'native'),
  twoPhaseCommit: capability('twoPhaseCommit', 'conditional', {requires: ['max_prepared_transactions>0']}),
  transactionalDdl: capability('transactionalDdl', 'native'),
  catalogs: capability('catalogs', 'native'),
  schemas: capability('schemas', 'native'),
  generatedKeys: capability('generatedKeys', 'native', {notes: 'Typically obtained through RETURNING'}),
  returning: capability('returning', 'native'),
  upsert: capability('upsert', 'native', {notes: 'ON CONFLICT semantics'}),
  merge: capability('merge', 'native', {since: '15'}),
  cte: capability('cte', 'native'),
  recursiveCte: capability('recursiveCte', 'native'),
  windowFunctions: capability('windowFunctions', 'native'),
  nativeJson: capability('nativeJson', 'native'),
  arrays: capability('arrays', 'native'),
  uuid: capability('uuid', 'native'),
  spatial: capability('spatial', 'conditional', {requires: ['PostGIS'], notes: 'Core PostgreSQL geometric types are distinct from PostGIS GIS support'}),
  fullTextSearch: capability('fullTextSearch', 'native'),
  bulkLoad: capability('bulkLoad', 'native'),
  copyProtocol: capability('copyProtocol', 'native'),
  changeDataCapture: capability('changeDataCapture', 'conditional', {requires: ['logical-replication']}),
  notifications: capability('notifications', 'native', {notes: 'LISTEN/NOTIFY'}),
  sessionState: capability('sessionState', 'native'),
  roleSwitching: capability('roleSwitching', 'native'),
  advisoryLocks: capability('advisoryLocks', 'native'),
  storedProcedures: capability('storedProcedures', 'native'),
  storedFunctions: capability('storedFunctions', 'native'),
  sequences: capability('sequences', 'native'),
  identityColumns: capability('identityColumns', 'native'),
  partitioning: capability('partitioning', 'native'),
  materializedViews: capability('materializedViews', 'native'),
  extensions: capability('extensions', 'native'),
  explain: capability('explain', 'native'),
  explainAnalyze: capability('explainAnalyze', 'native')
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
  capabilityProfile: capabilityProfile,
  services: services,
  supports: function supports(capabilityName) {
    if (Object.prototype.hasOwnProperty.call(capabilities, capabilityName)) return capabilities[capabilityName] === true;
    var entry = capabilityProfile[capabilityName];
    return Boolean(entry && (entry.level === 'native' || entry.level === 'emulated' || entry.level === 'conditional'));
  },
  capability: function getCapability(capabilityName) {
    return capabilityProfile[capabilityName] || capability(capabilityName, 'unknown');
  }
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
exports.capabilityProfile = capabilityProfile;
exports.services = services;
exports.createObjectName = createObjectName;
exports.protocol = protocol;
exports.Connection = connectionModule.Connection;
exports.PostgreSqlError = connectionModule.PostgreSqlError;
exports.createConnection = createConnection;
