'use strict';

var tds = require('./lib/TdsPacket');
var prelogin = require('./lib/Prelogin');

var capabilities = Object.freeze({
  preparedStatements    : false,
  serverSideCursors     : false,
  savepoints            : false,
  catalogs              : false,
  schemas               : false,
  transactionalDdl      : false,
  queryCancellation     : false,
  changeDataCapture     : false,
  nativeJson            : false,
  multipleActiveResults : false
});

var plannedCapabilities = Object.freeze({
  preparedStatements    : true,
  serverSideCursors     : true,
  savepoints            : true,
  catalogs              : true,
  schemas               : true,
  transactionalDdl      : true,
  queryCancellation     : true,
  changeDataCapture     : true,
  nativeJson            : true,
  multipleActiveResults : true
});

function quoteIdentifier(identifier) {
  if (typeof identifier !== 'string' || identifier.length === 0) throw new TypeError('SQL Server identifier must be a non-empty string');
  if (identifier.indexOf('\0') !== -1) throw new TypeError('SQL Server identifier cannot contain NUL bytes');
  return '[' + identifier.replace(/\]/g, ']]') + ']';
}

function placeholder(index) {
  if (!Number.isInteger(index) || index < 1) throw new RangeError('SQL Server placeholder index must be a positive integer');
  return '@p' + index;
}

var services = Object.freeze({ quoteIdentifier: quoteIdentifier, placeholder: placeholder });
var descriptor = Object.freeze({
  identity: Object.freeze({ family: 'sqlserver', name: 'Microsoft SQL Server', status: 'development' }),
  capabilities: capabilities,
  plannedCapabilities: plannedCapabilities,
  services: services,
  supports: function supports(capability) { return capabilities[capability] === true; }
});

exports.descriptor = descriptor;
exports.capabilities = capabilities;
exports.plannedCapabilities = plannedCapabilities;
exports.services = services;
exports.TdsPacket = tds;
exports.Prelogin = prelogin;
