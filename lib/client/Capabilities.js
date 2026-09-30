'use strict';

function copyBooleanMap(source) {
  var out = {};
  Object.keys(source || {}).forEach(function (key) { out[key] = source[key] === true; });
  return Object.freeze(out);
}

function supportEntries(source) {
  var out = {};
  Object.keys(source || {}).forEach(function (key) {
    out[key] = Object.freeze({ supported: source[key] === true, source: 'dialect' });
  });
  return Object.freeze(out);
}

function runtimeInfo() {
  return Object.freeze({
    nodeVersion: process.version,
    v8Version: process.versions.v8 || null,
    modules: process.versions.modules || null,
    sqliteVersion: process.versions.sqlite || null,
    platform: process.platform,
    arch: process.arch
  });
}

function sqlServerVersion(loginAck) {
  if (!loginAck || !loginAck.programVersion) return null;
  var version = loginAck.programVersion;
  var build = ((version.buildHigh || 0) << 8) | (version.buildLow || 0);
  return [version.major || 0, version.minor || 0, build].join('.');
}

function serverInfo(dialect, target) {
  target = target || null;
  if (!target) return null;

  if (dialect === 'mysql') {
    var mysqlServer = target.server || null;
    return Object.freeze({
      connected: target.connected === true,
      version: mysqlServer && mysqlServer.serverVersion || null,
      protocolVersion: mysqlServer && mysqlServer.protocolVersion || null,
      capabilityFlags: mysqlServer && mysqlServer.capabilityFlags !== undefined ? mysqlServer.capabilityFlags : null,
      authPlugin: mysqlServer && mysqlServer.authPluginName || null,
      secure: target.secure === true
    });
  }

  if (dialect === 'postgresql') {
    var parameters = target.parameters || {};
    return Object.freeze({
      connected: target.connected === true,
      version: parameters.server_version || null,
      protocolVersion: target.config && target.config.protocolVersion || null,
      serverEncoding: parameters.server_encoding || null,
      clientEncoding: parameters.client_encoding || null,
      integerDatetimes: parameters.integer_datetimes || null
    });
  }

  if (dialect === 'sqlserver') {
    var loginAck = target.loginResponse && target.loginResponse.loginAck || null;
    return Object.freeze({
      connected: target.connected === true,
      version: sqlServerVersion(loginAck),
      productName: loginAck && loginAck.programName || null,
      protocolVersion: loginAck && loginAck.tdsVersion !== undefined ? loginAck.tdsVersion : null,
      prelogin: target.serverPrelogin || null,
      alpnProtocol: target.socket && target.socket.alpnProtocol || null
    });
  }

  if (dialect === 'sqlite') {
    return Object.freeze({
      connected: target.ended !== true,
      version: process.versions.sqlite || null,
      protocolVersion: null,
      filename: target.filename === undefined ? null : target.filename
    });
  }

  return Object.freeze({ connected: target.connected === true, version: null, protocolVersion: null });
}

function buildReport(dialect, descriptor, target, pool) {
  descriptor = descriptor || {};
  var capabilities = copyBooleanMap(descriptor.capabilities || {});
  return Object.freeze({
    dialect: dialect,
    identity: descriptor.identity || null,
    capabilities: capabilities,
    support: supportEntries(capabilities),
    plannedCapabilities: copyBooleanMap(descriptor.plannedCapabilities || {}),
    runtime: runtimeInfo(),
    server: serverInfo(dialect, target),
    pool: pool === true
  });
}

function install(clientApi) {
  if (!clientApi || !clientApi.Client) throw new TypeError('Capabilities requires the NuBloxSQL Client API');
  var Client = clientApi.Client;
  if (Client.prototype.capabilityReport) return;

  Client.prototype.capabilityReport = function capabilityReport() {
    return buildReport(this.dialect, this.descriptor, this._isPool ? null : this._target, this._isPool === true);
  };

  Client.prototype.discoverCapabilities = async function discoverCapabilities(options) {
    options = options || {};
    if (this._isPool) {
      var connection = await this._target.getConnection(options.acquire || {});
      try { return buildReport(this.dialect, this.descriptor, connection, true); }
      finally { await this._target.releaseConnection(connection); }
    }
    await this.open();
    return buildReport(this.dialect, this.descriptor, this._target, false);
  };
}

exports.buildReport = buildReport;
exports.serverInfo = serverInfo;
exports.install = install;
