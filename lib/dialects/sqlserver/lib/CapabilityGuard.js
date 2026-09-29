'use strict';

function unsupported(SqlServerError, capability, message) {
  return new SqlServerError(message, {
    code: 'NUBLOXSQL_UNSUPPORTED',
    category: 'unsupported',
    capability: capability,
    retryable: false
  });
}

function install(Connection, SqlServerError) {
  if (!Connection || !Connection.prototype || typeof Connection.prototype.connect !== 'function') {
    throw new TypeError('SQL Server capability guard requires a Connection class');
  }
  if (Connection.prototype.__nubloxCapabilityGuardInstalled) return;

  var originalConnect = Connection.prototype.connect;
  Connection.prototype.connect = function connectWithCapabilityGuard() {
    var config = this.config || {};
    if (config.mars !== undefined && typeof config.mars !== 'boolean') {
      return Promise.reject(new TypeError('SQL Server mars must be a boolean when provided'));
    }
    if (config.mars === true) {
      return Promise.reject(unsupported(
        SqlServerError,
        'multipleActiveResults',
        'SQL Server MARS is not implemented by this NuBloxSQL runtime; mars:true cannot be negotiated safely'
      ));
    }
    return originalConnect.apply(this, arguments);
  };

  Object.defineProperty(Connection.prototype, '__nubloxCapabilityGuardInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
}

exports.install = install;
