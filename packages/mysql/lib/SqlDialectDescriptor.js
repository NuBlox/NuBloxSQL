'use strict';

var capabilities = Object.freeze({
  preparedStatements    : true,
  serverSideCursors     : true,
  savepoints            : true,
  catalogs              : true,
  schemas               : false,
  transactionalDdl      : false,
  queryCancellation     : true,
  changeDataCapture     : true,
  nativeJson            : true,
  multipleActiveResults : false
});

function capability(name, level, options) {
  options = options || {};
  return Object.freeze({
    name      : name,
    level     : level,
    since     : options.since,
    until     : options.until,
    requires  : options.requires ? Object.freeze(options.requires.slice()) : undefined,
    notes     : options.notes,
    extension : options.extension
  });
}

var capabilityProfile = Object.freeze({
  connectionPooling         : capability('connectionPooling', 'native'),
  tls                       : capability('tls', 'native'),
  mutualTls                 : capability('mutualTls', 'conditional', {requires: ['client-certificate']}),
  preparedStatements        : capability('preparedStatements', 'native'),
  serverPreparedStatements  : capability('serverPreparedStatements', 'native'),
  namedParameters           : capability('namedParameters', 'emulated', {notes: 'Client-side named placeholder expansion'}),
  positionalParameters      : capability('positionalParameters', 'native'),
  binaryProtocol            : capability('binaryProtocol', 'native'),
  serverSideCursors         : capability('serverSideCursors', 'native'),
  streamingResults          : capability('streamingResults', 'native'),
  queryCancellation         : capability('queryCancellation', 'native'),
  queryTimeout              : capability('queryTimeout', 'native'),
  multiStatement            : capability('multiStatement', 'conditional', {requires: ['client-multi-statements']}),
  multiResult               : capability('multiResult', 'native'),
  multipleActiveResults     : capability('multipleActiveResults', 'unsupported'),
  savepoints                : capability('savepoints', 'native'),
  transactionIsolation      : capability('transactionIsolation', 'native'),
  readOnlyTransactions      : capability('readOnlyTransactions', 'native'),
  twoPhaseCommit            : capability('twoPhaseCommit', 'conditional', {notes: 'Server XA semantics are vendor-specific and not portable'}),
  transactionalDdl          : capability('transactionalDdl', 'unsupported', {notes: 'Many DDL statements cause implicit commits'}),
  catalogs                  : capability('catalogs', 'native'),
  schemas                   : capability('schemas', 'unsupported', {notes: 'MySQL schema is database/catalog terminology'}),
  generatedKeys             : capability('generatedKeys', 'native'),
  returning                 : capability('returning', 'unsupported'),
  upsert                    : capability('upsert', 'native', {notes: 'ON DUPLICATE KEY UPDATE semantics'}),
  merge                     : capability('merge', 'unsupported'),
  cte                       : capability('cte', 'native', {since: '8.0'}),
  recursiveCte              : capability('recursiveCte', 'native', {since: '8.0'}),
  windowFunctions           : capability('windowFunctions', 'native', {since: '8.0'}),
  nativeJson                : capability('nativeJson', 'native', {since: '5.7'}),
  arrays                    : capability('arrays', 'unsupported'),
  uuid                      : capability('uuid', 'emulated', {notes: 'Represented using string/binary conventions rather than a dedicated scalar type'}),
  spatial                   : capability('spatial', 'native'),
  fullTextSearch            : capability('fullTextSearch', 'native'),
  bulkLoad                  : capability('bulkLoad', 'native'),
  copyProtocol              : capability('copyProtocol', 'unsupported'),
  changeDataCapture         : capability('changeDataCapture', 'conditional', {requires: ['binary-log']}),
  notifications             : capability('notifications', 'unsupported'),
  sessionState              : capability('sessionState', 'native'),
  roleSwitching             : capability('roleSwitching', 'conditional', {notes: 'Depends on server version and grants'}),
  advisoryLocks             : capability('advisoryLocks', 'native'),
  storedProcedures          : capability('storedProcedures', 'native'),
  storedFunctions           : capability('storedFunctions', 'native'),
  sequences                 : capability('sequences', 'unsupported'),
  identityColumns           : capability('identityColumns', 'native', {notes: 'AUTO_INCREMENT semantics'}),
  partitioning              : capability('partitioning', 'native'),
  materializedViews         : capability('materializedViews', 'unsupported'),
  extensions                : capability('extensions', 'unsupported'),
  explain                   : capability('explain', 'native'),
  explainAnalyze            : capability('explainAnalyze', 'native')
});

var services = Object.freeze({
  quoteIdentifier: function quoteIdentifier(identifier) {
    if (typeof identifier !== 'string') {
      throw new TypeError('MySQL identifier must be a string');
    }

    return '`' + identifier.replace(/`/g, '``') + '`';
  },
  placeholder: function placeholder() {
    return '?';
  }
});

var descriptor = {
  identity: Object.freeze({
    family : 'mysql',
    name   : 'MySQL'
  }),
  capabilities      : capabilities,
  capabilityProfile : capabilityProfile,
  services          : services,
  supports          : function supports(capabilityName) {
    if (Object.prototype.hasOwnProperty.call(capabilities, capabilityName)) return capabilities[capabilityName] === true;
    var entry = capabilityProfile[capabilityName];
    return Boolean(entry && (entry.level === 'native' || entry.level === 'emulated' || entry.level === 'conditional'));
  },
  capability : function getCapability(capabilityName) {
    return capabilityProfile[capabilityName] || capability(capabilityName, 'unknown');
  }
};

module.exports = Object.freeze(descriptor);
