'use strict';

var net = require('net');
var tls = require('tls');
var EventEmitter = require('events').EventEmitter;
var protocol = require('..').protocol;

var SERVER_STATUS_MORE_RESULTS_EXISTS = 0x0008;

function MySqlError(message, details) {
  Error.call(this, message);
  this.name = 'MySqlError';
  this.message = message;
  details = details || {};
  this.code = details.code || null;
  this.sqlState = details.sqlState || null;
  if (Error.captureStackTrace) Error.captureStackTrace(this, MySqlError);
}
MySqlError.prototype = Object.create(Error.prototype);
MySqlError.prototype.constructor = MySqlError;

function normalizeSsl(ssl) {
  if (ssl === false || ssl === 'disable') return { mode: 'disable', options: null };
  if (ssl === true || ssl === 'require') return { mode: 'require', options: {} };
  if (ssl === 'prefer' || ssl === undefined) return { mode: 'prefer', options: {} };
  if (ssl && typeof ssl === 'object') return { mode: ssl.mode || 'require', options: ssl };
  throw new TypeError('Invalid MySQL ssl option');
}

function desiredCapabilities(config, useTls) {
  var c = protocol.capabilities;
  var flags = c.LONG_PASSWORD | c.LONG_FLAG | c.PROTOCOL_41 | c.TRANSACTIONS | c.SECURE_CONNECTION | c.MULTI_RESULTS | c.PLUGIN_AUTH | c.PLUGIN_AUTH_LENENC_CLIENT_DATA;
  if (config.database) flags |= c.CONNECT_WITH_DB;
  if (useTls) flags |= c.SSL;
  return flags >>> 0;
}

function authResponse(plugin, password, scramble, secure) {
  if (plugin === 'caching_sha2_password') return protocol.cachingSha2Password(password, scramble);
  if (plugin === 'mysql_native_password' || !plugin) return protocol.mysqlNativePassword(password, scramble);
  if (plugin === 'sha256_password' && secure) return protocol.cleartextPassword(password);
  throw new Error('Unsupported MySQL authentication plugin: ' + plugin);
}

function Connection(config) {
  EventEmitter.call(this);
  config = config || {};
  if (!config.user) throw new TypeError('MySQL connection requires user');
  this.config = Object.assign({ host: '127.0.0.1', port: 3306, connectTimeout: 10000 }, config);
  this.socket = null;
  this.connected = false;
  this.ended = false;
  this.secure = false;
  this.server = null;
  this._framer = new protocol.PacketFramer({ maxPayloadBytes: config.maxPayloadBytes });
  this._sequence = 0;
  this._connectState = null;
  this._queryState = null;
  this._closedEmitted = false;
}
Connection.prototype = Object.create(EventEmitter.prototype);
Connection.prototype.constructor = Connection;

Connection.prototype._emitError = function _emitError(error) {
  if (this.listenerCount('error') > 0) this.emit('error', error);
};

Connection.prototype._fail = function _fail(error) {
  if (!(error instanceof Error)) error = new Error(String(error));
  if (this._connectState) {
    var connectState = this._connectState;
    this._connectState = null;
    connectState.reject(error);
  }
  if (this._queryState) {
    var queryState = this._queryState;
    this._queryState = null;
    queryState.reject(error);
  }
  this._emitError(error);
};

Connection.prototype._write = function _write(payload) {
  this.socket.write(protocol.encodePacket(payload, this._sequence));
  this._sequence = (this._sequence + 1) & 0xff;
};

Connection.prototype._attachSocket = function _attachSocket(socket) {
  var self = this;
  this.socket = socket;
  socket.on('data', function (chunk) {
    try {
      var packets = self._framer.push(chunk);
      for (var i = 0; i < packets.length; i++) self._acceptPacket(packets[i]);
    } catch (error) {
      self._fail(error);
      socket.destroy();
    }
  });
  socket.on('error', function (error) { self._fail(error); });
  socket.on('close', function () {
    self.connected = false;
    self.ended = true;
    if (self._connectState || self._queryState) self._fail(new Error('MySQL connection closed unexpectedly'));
    if (!self._closedEmitted) {
      self._closedEmitted = true;
      self.emit('close');
    }
  });
};

Connection.prototype._acceptPacket = function _acceptPacket(packet) {
  if (packet.sequenceId !== this._sequence) throw new Error('Unexpected MySQL packet sequence: expected ' + this._sequence + ', received ' + packet.sequenceId);
  this._sequence = (this._sequence + 1) & 0xff;
  if (this._connectState) this._handleAuthPacket(packet.payload);
  else if (this._queryState) this._handleQueryPacket(packet.payload);
};

Connection.prototype._authToken = function _authToken(plugin, scramble) {
  return authResponse(plugin, this.config.password, scramble, this.secure);
};

Connection.prototype._sendHandshakeResponse = function _sendHandshakeResponse() {
  var state = this._connectState;
  var plugin = state.plugin;
  var response = protocol.encodeHandshakeResponse41({
    capabilities: state.capabilities,
    characterSet: this.config.characterSet || 45,
    maxPacketSize: this.config.maxPacketSize,
    user: this.config.user,
    database: this.config.database,
    authPluginName: plugin,
    authResponse: this._authToken(plugin, state.scramble)
  });
  this._write(response);
};

Connection.prototype._completeConnection = function _completeConnection() {
  var state = this._connectState;
  this._connectState = null;
  this.connected = true;
  state.resolve(this);
  this.emit('connect');
};

Connection.prototype._handleAuthPacket = function _handleAuthPacket(payload) {
  var state = this._connectState;
  if (payload[0] === 0x00) {
    this._completeConnection();
    return;
  }
  if (payload[0] === 0xff) {
    var err = protocol.decodeErrorPacket(payload);
    throw new MySqlError(err.message, err);
  }
  if (payload[0] === 0xfe && payload.length > 1) {
    var authSwitch = protocol.decodeAuthSwitchRequest(payload);
    state.plugin = authSwitch.pluginName;
    state.scramble = authSwitch.pluginData;
    this._write(this._authToken(state.plugin, state.scramble));
    return;
  }
  if (payload[0] === 0x01 && state.plugin === 'caching_sha2_password') {
    var status = payload[1];
    if (state.awaitingPublicKey && payload.length > 2) {
      var key = payload.subarray(1).toString('utf8').replace(/\0+$/, '');
      state.awaitingPublicKey = false;
      this._write(protocol.encryptCachingSha2Password(this.config.password, state.scramble, key));
      return;
    }
    if (status === 0x03) return;
    if (status === 0x04) {
      if (this.secure) {
        this._write(protocol.cleartextPassword(this.config.password));
        return;
      }
      if (this.config.serverPublicKey) {
        this._write(protocol.encryptCachingSha2Password(this.config.password, state.scramble, this.config.serverPublicKey));
        return;
      }
      if (this.config.getServerPublicKey) {
        state.awaitingPublicKey = true;
        this._write(Buffer.from([0x02]));
        return;
      }
      throw new Error('MySQL caching_sha2_password full authentication requires TLS, serverPublicKey, or getServerPublicKey');
    }
  }
  throw new Error('Unexpected MySQL authentication packet');
};

Connection.prototype._finishQuery = function _finishQuery(result, error) {
  var state = this._queryState;
  this._queryState = null;
  if (!state) return;
  if (error) state.reject(error);
  else state.resolve(result);
};

Connection.prototype._handleQueryPacket = function _handleQueryPacket(payload) {
  var state = this._queryState;
  if (payload[0] === 0xff) {
    var err = protocol.decodeErrorPacket(payload);
    this._finishQuery(null, new MySqlError(err.message, err));
    return;
  }
  if (state.phase === 'start' && payload[0] === 0x00) {
    var ok = protocol.decodeOkPacket(payload);
    this._finishQuery({ rows: [], fields: [], affectedRows: ok.affectedRows, insertId: ok.lastInsertId, serverStatus: ok.statusFlags, warningCount: ok.warnings });
    return;
  }
  if (state.phase === 'start') {
    var reader = new protocol.PacketReader(payload);
    state.columnCount = Number(reader.lengthEncodedInteger());
    state.phase = 'columns';
    return;
  }
  if (state.phase === 'columns') {
    state.fields.push(protocol.decodeColumnDefinition41(payload));
    if (state.fields.length === state.columnCount) state.phase = 'columnTerminator';
    return;
  }
  if (state.phase === 'columnTerminator') {
    if (payload[0] !== 0xfe || payload.length >= 9) throw new Error('Expected MySQL EOF after column definitions');
    protocol.decodeEofPacket(payload);
    state.phase = 'rows';
    return;
  }
  if (state.phase === 'rows') {
    if (payload[0] === 0xfe && payload.length < 9) {
      var eof = protocol.decodeEofPacket(payload);
      if (eof.statusFlags & SERVER_STATUS_MORE_RESULTS_EXISTS) throw new Error('Multiple MySQL result sets are not implemented in clean-room runtime yet');
      this._finishQuery({ rows: state.rows, fields: state.fields, affectedRows: 0, insertId: 0, serverStatus: eof.statusFlags, warningCount: eof.warnings });
      return;
    }
    state.rows.push(protocol.decodeTextRow(payload, state.fields));
  }
};

Connection.prototype.connect = function connect() {
  var self = this;
  if (this.connected) return Promise.resolve(this);
  if (this._connectState) return this._connectState.promise;
  if (this.ended) return Promise.reject(new Error('MySQL connection has ended'));

  var state = { plugin: null, scramble: null, capabilities: 0, awaitingPublicKey: false };
  state.promise = new Promise(function (resolve, reject) { state.resolve = resolve; state.reject = reject; });
  this._connectState = state;

  var raw = net.createConnection({ host: this.config.host, port: this.config.port });
  var handshakeFramer = new protocol.PacketFramer({ maxPayloadBytes: this.config.maxPayloadBytes });
  var ssl = normalizeSsl(this.config.ssl);
  var timer = setTimeout(function () {
    raw.destroy();
    self._fail(new Error('MySQL connection timed out'));
  }, this.config.connectTimeout);
  if (timer.unref) timer.unref();
  state.promise.then(function () { clearTimeout(timer); }, function () { clearTimeout(timer); });

  function initialError(error) { self._fail(error); }
  raw.once('error', initialError);
  raw.on('data', function onHandshakeData(chunk) {
    try {
      var packets = handshakeFramer.push(chunk);
      if (!packets.length) return;
      if (packets.length !== 1 || packets[0].sequenceId !== 0) throw new Error('Invalid MySQL initial handshake framing');
      raw.removeListener('data', onHandshakeData);
      raw.removeListener('error', initialError);
      self.server = protocol.parseHandshakeV10(packets[0].payload);
      state.plugin = self.server.authPluginName || 'mysql_native_password';
      state.scramble = self.server.authPluginData;
      var serverCaps = self.server.capabilityFlags >>> 0;
      var wantsTls = ssl.mode !== 'disable';
      var canTls = (serverCaps & protocol.capabilities.SSL) !== 0;
      if (wantsTls && !canTls && ssl.mode === 'require') throw new Error('MySQL server does not support TLS');
      var useTls = wantsTls && canTls;
      state.capabilities = (desiredCapabilities(self.config, useTls) & serverCaps) >>> 0;
      if ((state.capabilities & protocol.capabilities.PROTOCOL_41) === 0) throw new Error('MySQL server does not support protocol 4.1');
      self._sequence = 1;

      if (!useTls) {
        self._framer.reset();
        self._attachSocket(raw);
        self._sendHandshakeResponse();
        return;
      }

      self.socket = raw;
      self._write(protocol.encodeSslRequest({ capabilities: state.capabilities, characterSet: self.config.characterSet || 45, maxPacketSize: self.config.maxPacketSize }));
      var tlsOptions = Object.assign({}, ssl.options || {}, { socket: raw, servername: (ssl.options && ssl.options.servername) || self.config.host });
      delete tlsOptions.mode;
      var secureSocket = tls.connect(tlsOptions, function () {
        self.secure = true;
        self._framer.reset();
        self._attachSocket(secureSocket);
        self._sendHandshakeResponse();
      });
      secureSocket.once('error', function (error) { self._fail(error); });
    } catch (error) {
      self._fail(error);
      raw.destroy();
    }
  });

  if (this.config.signal) {
    if (this.config.signal.aborted) {
      raw.destroy();
      this._fail(this.config.signal.reason || new Error('MySQL connection aborted'));
      return state.promise;
    }
    this.config.signal.addEventListener('abort', function () {
      raw.destroy();
      self._fail(self.config.signal.reason || new Error('MySQL connection aborted'));
    }, { once: true });
  }

  return state.promise;
};

Connection.prototype.query = function query(sql, options) {
  options = options || {};
  if (!this.connected || !this.socket || this.ended) return Promise.reject(new Error('MySQL connection is not ready'));
  if (this._queryState) return Promise.reject(new Error('MySQL connection already has an active query'));
  if (options.timeout !== undefined && (!Number.isFinite(options.timeout) || options.timeout <= 0)) return Promise.reject(new RangeError('MySQL query timeout must be a positive number'));
  if (options.signal && options.signal.aborted) return Promise.reject(options.signal.reason || new Error('MySQL query aborted'));

  var self = this;
  var state = { phase: 'start', columnCount: 0, fields: [], rows: [] };
  state.promise = new Promise(function (resolve, reject) { state.resolve = resolve; state.reject = reject; });
  this._queryState = state;
  this._sequence = 0;

  var timer = null;
  if (options.timeout !== undefined) {
    timer = setTimeout(function () { self.destroy(new Error('MySQL query timed out')); }, options.timeout);
    if (timer.unref) timer.unref();
  }
  state.promise.then(function () { if (timer) clearTimeout(timer); }, function () { if (timer) clearTimeout(timer); });

  if (options.signal) {
    options.signal.addEventListener('abort', function () { self.destroy(options.signal.reason || new Error('MySQL query aborted')); }, { once: true });
  }

  this._write(protocol.encodeQuery(sql));
  return state.promise;
};

Connection.prototype.end = function end() {
  if (!this.socket || this.ended) return Promise.resolve();
  this.ended = true;
  try {
    this._sequence = 0;
    this._write(protocol.encodeQuit());
    this.socket.end();
  } catch (error) {
    this.socket.destroy();
  }
  return Promise.resolve();
};

Connection.prototype.destroy = function destroy(error) {
  this.ended = true;
  if (this.socket) this.socket.destroy();
  if (error) this._fail(error);
};

exports.Connection = Connection;
exports.MySqlError = MySqlError;
exports.normalizeSsl = normalizeSsl;
