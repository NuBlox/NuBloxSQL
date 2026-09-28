'use strict';

var capabilities = Object.freeze({
  preparedStatements: true,
  serverSideCursors: true,
  savepoints: true,
  catalogs: true,
  schemas: false,
  transactionalDdl: false,
  queryCancellation: true,
  changeDataCapture: true,
  nativeJson: true,
  multipleActiveResults: false
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
    family: 'mysql',
    name: 'MySQL'
  }),
  capabilities: capabilities,
  services: services,
  supports: function supports(capability) {
    return capabilities[capability] === true;
  }
};

module.exports = Object.freeze(descriptor);
