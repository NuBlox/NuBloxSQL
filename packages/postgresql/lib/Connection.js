'use strict';

var crypto = require('crypto');
var net = require('net');
var tls = require('tls');
var EventEmitter = require('events').EventEmitter;
var protocol = require('./protocol');
var frontend = require('./protocol/FrontendMessage');
var ScramSha256 = require('./ScramSha256').ScramSha256;

function PostgreSqlError(message, fields) {
  Error.call(this, message);
  this.name = 'PostgreSqlError';
  this.message = message;
  this.fields = fields || Object.create(null);
  this.code = this.fields.C;
  this.severity = this.fields.V || this.fields.S;
  if (Error.captureStackTrace) Error.captureStackTrace(this, PostgreSqlError);
}
PostgreSqlError.prototype = Object.create(Error.prototype);
PostgreSqlError.prototype.constructor = PostgreSqlError;

function md5(value) {
  return crypto.createHash('md5').update(value).digest('hex');
}

function md5Password(user, password, salt) {
  var inner = md5(String(password) + String(user));
  return 'md5' + md5(Buffer.concat([Buffer.from(inner, 'utf8'), salt]));
}

function commandRowCount(tag) {
  var parts = String(tag || '').trim().split(/\s+/);
  if (!parts.length) return null;
  var value = Number(parts[parts.length - 1]);
  return Number.isSafeInteger(value) ? value : null;
}

function decodeTextValue(field, value) {
  if (value === null) return null;
  var text = value.toString('utf8');
  switch (field && field.dataTypeOid) {
    case 16: return text === 't';
    case 20:
    case 21:
    case 23: {
      var integer = Number(text);
      return Number.isSafeInteger(integer) ? integer : text;
    }
    case 700:
    case 701:
    case 1700: {
      var number = Number(text);
      return Number.isFinite(number) ? number : text;
    }
    case 114:
    case 3802:
      try { return JSON.parse(text); } catch (error) { return text; }
    default: return text;
  }
}

function normalizeSsl(ssl) {
  if (ssl === false || ssl === 'disable') return { mode: 'disable', options: null };
  if (ssl === true || ssl === 'require') return { mode: 'require', options: {} };
  if (ssl && typeof ssl === 'object') return { mode: ssl.mode || 'require', options: ssl };
  return { mode: 'prefer', options: null };
}

function Connection(config) {
  EventEmitter.call(this);
  config = config || {};
  if (!config.user) throw new TypeError('PostgreSQL connection requires user');
  this.config = Object.assign({ host: '127.0.0.1', port: 5432, connectTimeout: 10000 }, config);
  this.socket = null;
  this.parser = new protocol.BackendMessageParser({ maxMessageSize: config.maxMessageSize });
  this.parameters = Object.create(null);
  this.backendKeyData = null;
  this.transactionStatus = null;
  this.connected = false;
  this.ended = false;
  this._connectState = null;
  this._currentQuery = null;
  this._scram = null;
}
Connection.prototype = Object.create(EventEmitter.prototype);
Connection.prototype.constructor = Connection;

Connection.prototype._fail = function _fail(error) {
  if (!(error instanceof Error)) error = new Error(String(error));
  if (this._connectState) {
    var connectState = this._connectState;
    this._connectState = null;
    connectState.reject(error);
  }
  if (this._currentQuery) {
    var query = this._currentQuery;
    this._currentQuery = null;
    query.reject(error);
  }
  if (this.listenerCount('error') > 0) this.emit('error', error);
};

Connection.prototype._attachSocket = function _attachSocket(socket) {
  var self = this;
  this.socket = socket;
  socket.on('data', function (chunk) {
    try {
      var messages = self.parser.push(chunk);
      for (var i = 0; i < messages.length; i++) self._handleMessage(messages[i]);
    } catch (error) {
      self._fail(error);
      socket.destroy();
    }
  });
  socket.on('error', function (error) { self._fail(error); });
  socket.on('close', function () {
    self.connected = false;
    self.ended = true;
    if (self._connectState || self._currentQuery) self._fail(new Error('PostgreSQL connection closed unexpectedly'));
    self.emit('close');
  });
};

Connection.prototype._sendStartup = function _sendStartup() {
  var params = Object.assign({}, this.config.parameters || {}, {
    user: this.config.user,
    database: this.config.database || this.config.user,
    application_name: this.config.applicationName || 'NuBloxSQL'
  });
  this.socket.write(protocol.encodeStartupMessage(params, this.config.protocolVersion));
};

Connection.prototype._handleAuthentication = function _handleAuthentication(message) {
  var code = message.code;
  if (code === 0) return;
  if (code === 3) {
    if (this.config.password === undefined) throw new Error('PostgreSQL server requested a password but none was provided');
    this.socket.write(frontend.encodePasswordMessage(this.config.password));
    return;
  }
  if (code === 5) {
    if (this.config.password === undefined) throw new Error('PostgreSQL server requested a password but none was provided');
    this.socket.write(frontend.encodePasswordMessage(md5Password(this.config.user, this.config.password, message.salt)));
    return;
  }
  if (code === 10) {
    if (!message.mechanisms || message.mechanisms.indexOf('SCRAM-SHA-256') === -1) throw new Error('PostgreSQL server did not offer SCRAM-SHA-256');
    if (this.config.password === undefined) throw new Error('PostgreSQL server requested SCRAM authentication but no password was provided');
    this._scram = new ScramSha256(this.config.user, this.config.password);
    this.socket.write(frontend.encodeSaslInitialResponse('SCRAM-SHA-256', this._scram.initialResponse()));
    return;
  }
  if (code === 11) {
    if (!this._scram) throw new Error('Unexpected PostgreSQL SASL continue message');
    this.socket.write(frontend.encodeSaslResponse(this._scram.continue(message.data.toString('utf8'))));
    return;
  }
  if (code === 12) {
    if (!this._scram) throw new Error('Unexpected PostgreSQL SASL final message');
    this._scram.verify(message.data.toString('utf8'));
    return;
  }
  throw new Error('Unsupported PostgreSQL authentication method: ' + code);
};

Connection.prototype._handleMessage = function _handleMessage(message) {
  if (message.type === 'authentication') return this._handleAuthentication(message);
  if (message.type === 'parameterStatus') {
    this.parameters[message.name] = message.value;
    this.emit('parameterStatus', message);
    return;
  }
  if (message.type === 'backendKeyData') {
    this.backendKeyData = message;
    return;
  }
  if (message.type === 'noticeResponse') {
    this.emit('notice', message.fields);
    return;
  }
  if (message.type === 'errorResponse') {
    var error = new PostgreSqlError(message.fields.M || 'PostgreSQL error', message.fields);
    if (this._currentQuery) this._currentQuery.error = error;
    else this._fail(error);
    return;
  }
  if (message.type === 'rowDescription' && this._currentQuery) {
    this._currentQuery.fields = message.fields;
    return;
  }
  if (message.type === 'dataRow' && this._currentQuery) {
    var row = Object.create(null);
    var fields = this._currentQuery.fields || [];
    for (var i = 0; i < message.values.length; i++) {
      var field = fields[i] || { name: String(i) };
      row[field.name] = decodeTextValue(field, message.values[i]);
    }
    this._currentQuery.rows.push(row);
    return;
  }
  if (message.type === 'commandComplete' && this._currentQuery) {
    this._currentQuery.command = message.tag;
    this._currentQuery.rowCount = commandRowCount(message.tag);
    return;
  }
  if (message.type === 'emptyQueryResponse' && this._currentQuery) {
    this._currentQuery.command = '';
    this._currentQuery.rowCount = 0;
    return;
  }
  if (message.type === 'readyForQuery') {
    this.transactionStatus = message.transactionStatus;
    if (this._connectState) {
      var state = this._connectState;
      this._connectState = null;
      this.connected = true;
      state.resolve(this);
      this.emit('connect');
      return;
    }
    if (this._currentQuery) {
      var query = this._currentQuery;
      this._currentQuery = null;
      if (query.error) query.reject(query.error);
      else query.resolve({ rows: query.rows, fields: query.fields || [], command: query.command || '', rowCount: query.rowCount });
    }
  }
};

Connection.prototype.connect = function connect() {
  var self = this;
  if (this.connected) return Promise.resolve(this);
  if (this._connectState) return this._connectState.promise;
  var socket = net.createConnection({ host: this.config.host, port: this.config.port });
  var ssl = normalizeSsl(this.config.ssl);
  var state = {};
  state.promise = new Promise(function (resolve, reject) { state.resolve = resolve; state.reject = reject; });
  this._connectState = state;

  var timer = setTimeout(function () {
    socket.destroy();
    self._fail(new Error('PostgreSQL connection timed out'));
  }, this.config.connectTimeout);
  if (timer.unref) timer.unref();

  function clearConnectTimer() { clearTimeout(timer); }
  state.promise.then(clearConnectTimer, clearConnectTimer);

  if (this.config.signal) {
    if (this.config.signal.aborted) {
      socket.destroy();
      this._fail(this.config.signal.reason || new Error('PostgreSQL connection aborted'));
      return state.promise;
    }
    this.config.signal.addEventListener('abort', function () {
      socket.destroy();
      self._fail(self.config.signal.reason || new Error('PostgreSQL connection aborted'));
    }, { once: true });
  }

  socket.once('error', function (error) { self._fail(error); });
  socket.once('connect', function () {
    if (ssl.mode === 'disable') {
      self._attachSocket(socket);
      self._sendStartup();
      return;
    }
    socket.write(protocol.encodeSSLRequest());
    socket.once('data', function onSslResponse(chunk) {
      var response = String.fromCharCode(chunk[0]);
      var rest = chunk.subarray(1);
      if (response === 'S') {
        var tlsOptions = Object.assign({}, ssl.options || {}, { socket: socket, servername: self.config.host });
        delete tlsOptions.mode;
        var secureSocket = tls.connect(tlsOptions, function () {
          self._attachSocket(secureSocket);
          self._sendStartup();
          if (rest.length) secureSocket.emit('data', rest);
        });
        secureSocket.once('error', function (error) { self._fail(error); });
      } else if (response === 'N' && ssl.mode !== 'require') {
        self._attachSocket(socket);
        self._sendStartup();
        if (rest.length) socket.emit('data', rest);
      } else {
        socket.destroy();
        self._fail(new Error(response === 'N' ? 'PostgreSQL server refused TLS' : 'Invalid PostgreSQL SSL negotiation response'));
      }
    });
  });
  return state.promise;
};

Connection.prototype.query = function query(sql, options) {
  options = options || {};
  if (!this.connected || !this.socket || this.ended) return Promise.reject(new Error('PostgreSQL connection is not ready'));
  if (this._currentQuery) return Promise.reject(new Error('PostgreSQL connection already has an active query'));
  if (options.timeout !== undefined && (!Number.isFinite(options.timeout) || options.timeout <= 0)) {
    return Promise.reject(new RangeError('PostgreSQL query timeout must be a positive number'));
  }
  if (options.signal && options.signal.aborted) {
    return Promise.reject(options.signal.reason || new Error('PostgreSQL query aborted'));
  }

  var self = this;
  var state = { rows: [], fields: null, command: '', rowCount: null, error: null };
  state.promise = new Promise(function (resolve, reject) { state.resolve = resolve; state.reject = reject; });
  this._currentQuery = state;

  var timer = null;
  if (options.timeout !== undefined) {
    timer = setTimeout(function () {
      self.destroy(new Error('PostgreSQL query timed out'));
    }, options.timeout);
    if (timer.unref) timer.unref();
  }
  state.promise.then(function () { if (timer) clearTimeout(timer); }, function () { if (timer) clearTimeout(timer); });

  if (options.signal) {
    options.signal.addEventListener('abort', function () {
      self.destroy(options.signal.reason || new Error('PostgreSQL query aborted'));
    }, { once: true });
  }

  this.socket.write(frontend.encodeQuery(sql));
  return state.promise;
};

Connection.prototype.end = function end() {
  if (!this.socket || this.ended) return Promise.resolve();
  this.ended = true;
  try { this.socket.end(frontend.encodeTerminate()); } catch (error) { this.socket.destroy(); }
  return Promise.resolve();
};

Connection.prototype.destroy = function destroy(error) {
  this.ended = true;
  if (this.socket) this.socket.destroy();
  if (error) this._fail(error);
};

exports.Connection = Connection;
exports.PostgreSqlError = PostgreSqlError;
exports.md5Password = md5Password;
exports.decodeTextValue = decodeTextValue;
