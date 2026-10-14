'use strict';

var net = require('net');

// TCP routing, TDS LOGIN7 server identity and TLS certificate verification
// are distinct. Explicit hostnameInCertificate takes precedence over the
// LOGIN7 serverName for both TDS 8.0 and TDS 7.4 transport paths.
function commonOptions(config) {
  var host = config.host || '127.0.0.1';
  var serverName = config.hostnameInCertificate;

  if (serverName !== undefined) {
    if (typeof serverName !== 'string' || !serverName.trim() || net.isIP(serverName)) {
      throw new TypeError('SQL Server hostnameInCertificate must be a nonempty DNS hostname');
    }
  } else {
    serverName = config.serverName;
  }
  if (!serverName && !net.isIP(host)) serverName = host;

  var options = {
    minVersion: config.minTlsVersion || 'TLSv1.2',
    rejectUnauthorized: config.rejectUnauthorized !== false
  };
  if (serverName) options.servername = serverName;
  ['ca', 'cert', 'key', 'pfx', 'passphrase', 'ciphers', 'maxVersion'].forEach(function (name) {
    if (config[name] !== undefined) options[name] = config[name];
  });
  return options;
}

function buildTds8Options(config) {
  return Object.assign({
    host: config.host || '127.0.0.1',
    port: config.port === undefined ? 1433 : config.port,
    ALPNProtocols: ['tds/8.0']
  }, commonOptions(config));
}

function buildTds74Options(config, socket) {
  return Object.assign({ socket: socket }, commonOptions(config));
}

exports.buildTds8Options = buildTds8Options;
exports.buildTds74Options = buildTds74Options;
