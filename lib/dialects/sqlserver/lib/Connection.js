'use strict';

var tls = require('tls');
var net = require('net');
var TdsPacket = require('./TdsPacket');
var Prelogin = require('./Prelogin');
var Login7 = require('./Login7');
var TokenStream = require('./TokenStream');
var MessageIO = require('./MessageIO').MessageIO;

function SqlServerError(message, details) {
  this.name = 'SqlServerError';
  this.message = String(message || 'SQL Server error');
  if (Error.captureStackTrace) Error.captureStackTrace(this, SqlServerError);
  Object.assign(this, details || {});
}
SqlServerError.prototype = Object.create(Error.prototype);
SqlServerError.prototype.constructor = SqlServerError;

function onceSecure(socket, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { cleanup(); reject(new SqlServerError('SQL Server TLS handshake timed out')); }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      socket.removeListener('secureConnect', secure);
      socket.removeListener('error', fail);
      socket.removeListener('close', closed);
    }
    function secure() { cleanup(); resolve(); }
    function fail(error) { cleanup(); reject(error); }
    function closed() { cleanup(); reject(new SqlServerError('SQL Server transport closed during TLS handshake')); }
    socket.once('secureConnect', secure);
    socket.once('error', fail);
    socket.once('close', closed);
  });
}

function buildTlsOptions(config) {
  var options = {
    host: config.host || '127.0.0.1',
    port: config.port === undefined ? 1433 : config.port,
    ALPNProtocols: ['tds/8.0'],
    minVersion: config.minTlsVersion || 'TLSv1.2',
    rejectUnauthorized: config.rejectUnauthorized !== false
  };
  var serverName = config.serverName || config.hostnameInCertificate;
  if (!serverName && !net.isIP(options.host)) serverName = options.host;
  if (serverName) options.servername = serverName;
  ['ca', 'cert', 'key', 'pfx', 'passphrase', 'ciphers'].forEach(function (name) {
    if (config[name] !== undefined) options[name] = config[name];
  });
  return options;
}

function Connection(config, dependencies) {
  config = config || {};
  dependencies = dependencies || {};
  if (config.user !== undefined && typeof config.user !== 'string') throw new TypeError('SQL Server user must be a string');
  if (config.password !== undefined && typeof config.password !== 'string') throw new TypeError('SQL Server password must be a string');
  if (config.database !== undefined && typeof config.database !== 'string') throw new TypeError('SQL Server database must be a string');
  this.config = config;
  this._tlsConnect = dependencies.tlsConnect || tls.connect;
  this.socket = null;
  this.io = null;
  this.connected = false;
  this.ended = false;
  this.serverPrelogin = null;
  this.loginResponse = null;
  this.packetSize = config.packetSize || 4096;
  this._connectPromise = null;
}

Connection.prototype.connect = function connect() {
  if (this.connected) return Promise.resolve(this);
  if (this.ended) return Promise.reject(new SqlServerError('SQL Server connection is closed'));
  if (this._connectPromise) return this._connectPromise;
  var self = this;
  this._connectPromise = this._connectTds8().then(function () {
    self.connected = true;
    return self;
  }).catch(function (error) {
    self._destroy();
    throw error;
  }).finally(function () { self._connectPromise = null; });
  return this._connectPromise;
};

Connection.prototype._connectTds8 = async function _connectTds8() {
  var timeout = this.config.connectTimeout === undefined ? 15000 : this.config.connectTimeout;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new RangeError('SQL Server connectTimeout must be a positive number');
  var socket = this._tlsConnect(buildTlsOptions(this.config));
  this.socket = socket;
  await onceSecure(socket, timeout);
  if (socket.alpnProtocol !== 'tds/8.0') {
    throw new SqlServerError('SQL Server did not negotiate TDS 8.0 via ALPN', { alpnProtocol: socket.alpnProtocol || null });
  }

  var io = new MessageIO(socket, { packetSize: this.packetSize });
  this.io = io;
  var preloginPayload = Prelogin.encode({
    version: this.config.clientVersion || { major: 1, minor: 0, build: 0, subbuild: 0 },
    encryption: Prelogin.ENCRYPTION.ON,
    instance: this.config.instance || '',
    threadId: this.config.clientPid === undefined ? process.pid : this.config.clientPid,
    mars: this.config.mars === true
  });
  await io.writeMessage(TdsPacket.PACKET_TYPES.PRELOGIN, preloginPayload);
  var preloginMessage = await io.readMessage(timeout);
  if (preloginMessage.type !== TdsPacket.PACKET_TYPES.RESPONSE) throw new SqlServerError('SQL Server returned unexpected PRELOGIN response packet type', { packetType: preloginMessage.type });
  this.serverPrelogin = Prelogin.decode(preloginMessage.payload);

  var loginPayload = Login7.encode({
    tdsVersion: Login7.TDS_74,
    packetSize: this.packetSize,
    clientProgramVersion: this.config.clientProgramVersion,
    clientPid: this.config.clientPid,
    hostName: this.config.hostName || '',
    user: this.config.user || '',
    password: this.config.password || '',
    appName: this.config.appName || 'NuBloxSQL',
    serverName: this.config.serverName || this.config.host || '',
    database: this.config.database || '',
    language: this.config.language || '',
    clientId: this.config.clientId,
    readOnlyIntent: this.config.readOnlyIntent === true
  });
  await io.writeMessage(TdsPacket.PACKET_TYPES.LOGIN7, loginPayload);
  var loginMessage = await io.readMessage(timeout);
  if (loginMessage.type !== TdsPacket.PACKET_TYPES.RESPONSE) throw new SqlServerError('SQL Server returned unexpected LOGIN7 response packet type', { packetType: loginMessage.type });
  var response = TokenStream.parseLoginResponse(loginMessage.payload);
  this.loginResponse = response;
  if (!response.success) {
    var nativeError = response.errors[0] || null;
    throw new SqlServerError(nativeError ? nativeError.message : 'SQL Server login failed', {
      code: nativeError ? nativeError.number : null,
      severity: nativeError ? nativeError.severity : null,
      state: nativeError ? nativeError.state : null,
      native: nativeError
    });
  }

  for (var i = 0; i < response.tokens.length; i++) {
    var token = response.tokens[i];
    if (token.type === 'envchange' && token.changeType === 4) {
      var negotiated = Number(token.newValue);
      if (Number.isInteger(negotiated) && negotiated >= 512 && negotiated <= TdsPacket.MAX_PACKET_LENGTH) {
        this.packetSize = negotiated;
        io.setPacketSize(negotiated);
      }
    }
  }
};

Connection.prototype._destroy = function _destroy() {
  this.connected = false;
  if (this.io) { this.io.detach(); this.io = null; }
  if (this.socket) {
    try { this.socket.destroy(); } catch (_) {}
    this.socket = null;
  }
};

Connection.prototype.end = async function end() {
  if (this.ended) return;
  this.ended = true;
  this.connected = false;
  if (this.io) { this.io.detach(); this.io = null; }
  var socket = this.socket;
  this.socket = null;
  if (!socket) return;
  await new Promise(function (resolve) {
    if (socket.destroyed) return resolve();
    socket.once('close', resolve);
    socket.end();
    setTimeout(function () { if (!socket.destroyed) socket.destroy(); }, 1000).unref();
  });
};
Connection.prototype.close = Connection.prototype.end;

exports.Connection = Connection;
exports.SqlServerError = SqlServerError;
exports.buildTlsOptions = buildTlsOptions;
