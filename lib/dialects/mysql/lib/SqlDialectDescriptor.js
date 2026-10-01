'use strict';

var CAPABILITIES = Object.freeze({
  preparedStatements: true,
  serverSideCursors: false,
  savepoints: true,
  transactions: true,
  transactionIsolation: true,
  readOnlyTransactions: true,
  deferrableTransactions: false,
  nestedTransactions: true,
  catalogs: true,
  schemas: false,
  transactionalDdl: false,
  queryCancellation: false,
  changeDataCapture: false,
  nativeJson: true,
  localInfile: true,
  multipleActiveResults: false
});

function quoteIdentifier(identifier) {
  return '`' + String(identifier).replace(/`/g, '``') + '`';
}

function placeholder() {
  return '?';
}

var descriptor = Object.freeze({
  identity: Object.freeze({ family: 'mysql', name: 'MySQL' }),
  capabilities: CAPABILITIES,
  services: Object.freeze({
    quoteIdentifier: quoteIdentifier,
    placeholder: placeholder
  }),
  supports: function supports(capability) {
    return CAPABILITIES[capability] === true;
  }
});

module.exports = descriptor;
