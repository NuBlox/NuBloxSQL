'use strict';

var Auth = require('./protocol/Auth');

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
  return Object.freeze(value);
}

var AUTHENTICATION_PLUGINS = deepFreeze({
  caching_sha2_password: {
    clientSupport: 'qualified',
    recommended: true,
    deprecated: false,
    passwordExchange: 'sha2-challenge-or-tls-or-rsa',
    secureTransportRequired: false,
    rsaSupported: true,
    publicKeyRetrievalSupported: true,
    notes: 'Preferred MySQL authentication plugin and modern server default.'
  },
  sha256_password: {
    clientSupport: 'qualified-deprecated',
    recommended: false,
    deprecated: true,
    passwordExchange: 'tls-or-rsa',
    secureTransportRequired: false,
    rsaSupported: true,
    publicKeyRetrievalSupported: true,
    notes: 'Deprecated by MySQL; supported for migration compatibility.'
  },
  mysql_native_password: {
    clientSupport: 'legacy',
    recommended: false,
    deprecated: true,
    passwordExchange: 'mysql41-sha1-challenge',
    secureTransportRequired: false,
    rsaSupported: false,
    publicKeyRetrievalSupported: false,
    notes: 'Legacy client support only; server plugin is disabled by default in MySQL 8.4 and removed in MySQL 9.0+.'
  },
  mysql_clear_password: {
    clientSupport: 'guarded',
    recommended: false,
    deprecated: false,
    passwordExchange: 'cleartext-over-secure-transport',
    secureTransportRequired: true,
    rsaSupported: false,
    publicKeyRetrievalSupported: false,
    explicitOptInRequired: true,
    notes: 'Client-side cleartext plugin is allowed only on a TLS-protected connection with allowCleartextAuth: true.'
  }
});

function parseServerMajor(version) {
  var match = String(version || '').match(/^(\d+)/);
  return match ? Number(match[1]) : null;
}

function serverAvailability(plugin, serverVersion) {
  var major = parseServerMajor(serverVersion);
  if (plugin === 'mysql_native_password') {
    if (major !== null && major >= 9) return 'removed';
    if (major === 8) return 'disabled-by-default';
    return 'legacy';
  }
  if (plugin === 'caching_sha2_password') return major !== null && major >= 8 ? 'default' : 'available';
  if (plugin === 'sha256_password') return 'deprecated';
  if (plugin === 'mysql_clear_password') return 'client-side';
  return 'unknown';
}

function authenticationPlugin(plugin, serverVersion) {
  var entry = AUTHENTICATION_PLUGINS[plugin];
  if (!entry) return deepFreeze({
    name: plugin,
    clientSupport: 'unsupported',
    serverAvailability: 'unknown',
    reason: 'NuBloxSQL has no built-in client authentication implementation for this plugin.'
  });
  return deepFreeze(Object.assign({ name: plugin, serverAvailability: serverAvailability(plugin, serverVersion) }, entry));
}

function authenticationPluginReport(serverVersion) {
  return Object.keys(AUTHENTICATION_PLUGINS).map(function (name) {
    return authenticationPlugin(name, serverVersion);
  });
}

function install(runtime) {
  var Connection = runtime.Connection;
  var originalAuthToken = Connection.prototype._authToken;
  var originalHandleAuthPacket = Connection.prototype._handleAuthPacket;

  Connection.prototype._authToken = function _authToken(plugin, scramble) {
    var state = this._connectState;
    if (plugin === 'sha256_password') {
      if (!this.config.password) return Buffer.from([0]);
      if (this.secure) return Auth.cleartextPassword(this.config.password);
      if (this.config.serverPublicKey) return Auth.encryptSha2Password(this.config.password, scramble, this.config.serverPublicKey);
      if (this.config.getServerPublicKey) {
        if (state) {
          state.awaitingPublicKey = true;
          state.publicKeyPlugin = 'sha256_password';
        }
        return Buffer.from([0x01]);
      }
      throw new Error('MySQL sha256_password authentication requires TLS, serverPublicKey, or getServerPublicKey');
    }
    if (plugin === 'mysql_clear_password') {
      if (!this.secure) throw new Error('MySQL mysql_clear_password authentication requires TLS');
      if (this.config.allowCleartextAuth !== true) throw new Error('MySQL mysql_clear_password authentication requires allowCleartextAuth: true');
      return Auth.cleartextPassword(this.config.password);
    }
    return originalAuthToken.call(this, plugin, scramble);
  };

  Connection.prototype._handleAuthPacket = function _handleAuthPacket(payload) {
    var state = this._connectState;
    if (state && state.awaitingPublicKey && state.publicKeyPlugin === 'sha256_password') {
      if (payload[0] === 0xff) return originalHandleAuthPacket.call(this, payload);
      var keyPayload = payload[0] === 0x01 ? payload.subarray(1) : payload;
      var key = keyPayload.toString('utf8').replace(/\0+$/, '');
      if (key.indexOf('-----BEGIN PUBLIC KEY-----') === -1 && key.indexOf('-----BEGIN RSA PUBLIC KEY-----') === -1) {
        throw new Error('MySQL sha256_password server returned an invalid RSA public key');
      }
      state.awaitingPublicKey = false;
      state.publicKeyPlugin = null;
      this._write(Auth.encryptSha2Password(this.config.password, state.scramble, key));
      return;
    }
    return originalHandleAuthPacket.call(this, payload);
  };
}

exports.AUTHENTICATION_PLUGINS = AUTHENTICATION_PLUGINS;
exports.authenticationPlugin = authenticationPlugin;
exports.authenticationPluginReport = authenticationPluginReport;
exports.serverAvailability = serverAvailability;
exports.parseServerMajor = parseServerMajor;
exports.install = install;
