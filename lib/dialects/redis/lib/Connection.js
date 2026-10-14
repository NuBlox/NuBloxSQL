'use strict';

const net = require('node:net');
const tls = require('node:tls');
const resp = require('./Resp2');

function positiveNumber(value, fallback, label, max) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new RangeError('Redis ' + label + ' must be a positive bounded integer');
  }
  return value;
}
function isLoopback(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}
function validateConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Redis connection config must be an options object');
  }
  const allowed = new Set(['host','port','username','password','database','tls',
    'connectTimeout','commandTimeout','maxResponseBytes','maxCommandBytes']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new TypeError('Unsupported Redis connection option: ' + key);
  }
  const config = Object.assign({host:'127.0.0.1',port:6379},input);
  if (typeof config.host !== 'string' || !config.host.trim()) throw new TypeError('Redis host must be a nonempty string');
  config.port = positiveNumber(config.port,6379,'port',65535);
  config.connectTimeout = positiveNumber(config.connectTimeout,10000,'connectTimeout',60000);
  config.commandTimeout = positiveNumber(config.commandTimeout,10000,'commandTimeout',60000);
  config.maxResponseBytes = positiveNumber(config.maxResponseBytes,8*1024*1024,'maxResponseBytes',16*1024*1024);
  config.maxCommandBytes = positiveNumber(config.maxCommandBytes,1024*1024,'maxCommandBytes',16*1024*1024);
  if (config.username !== undefined && (typeof config.username !== 'string' || !config.username)) throw new TypeError('Redis username must be a nonempty string');
  if (config.password !== undefined && typeof config.password !== 'string') throw new TypeError('Redis password must be a string');
  if (config.username && !config.password) throw new TypeError('Redis ACL username requires a password');
  if (config.database !== undefined && (!Number.isSafeInteger(config.database) || config.database < 0)) {
    throw new RangeError('Redis database must be a nonnegative integer');
  }
  const secure = config.tls === true || (config.tls && typeof config.tls === 'object' && !Array.isArray(config.tls));
  if (!secure && config.tls !== undefined && config.tls !== false) {
    throw new TypeError('Redis tls must be true, false or a TLS options object');
  }
  if (!secure && !isLoopback(config.host)) {
    throw new TypeError('Redis requires verified TLS for non-loopback endpoints');
  }
  if (secure && typeof config.tls === 'object') {
    const keys = ['ca','cert','key','pfx','passphrase','ciphers','servername','minVersion','maxVersion','rejectUnauthorized'];
    for (const key of Object.keys(config.tls)) {
      if (!keys.includes(key)) throw new TypeError('Unsupported Redis TLS option: ' + key);
    }
    if (config.tls.rejectUnauthorized === false) throw new TypeError('Redis TLS certificate verification cannot be disabled');
    if (config.tls.servername !== undefined &&
        (typeof config.tls.servername !== 'string' || !config.tls.servername.trim() ||
         net.isIP(config.tls.servername))) {
      throw new TypeError('Redis TLS servername must be a nonempty DNS name');
    }
  }
  if (secure && net.isIP(config.host) && (!config.tls || !config.tls.servername)) {
    throw new TypeError('Redis TLS connections to IP endpoints require certificate servername');
  }
  return config;
}

class RedisConnection {
  constructor(config = {}) {
    this.config = validateConfig(config);
    this.socket = null;
    this.connected = false;
    this.ended = false;
    this._connectPromise = null;
    this._pending = null;
    this._queue = Promise.resolve();
    this._buffer = Buffer.alloc(0);
  }
  _abort(error) {
    if (this.ended) return;
    this.connected = false;
    this.ended = true;
    const pending = this._pending;
    this._pending = null;
    this._buffer = Buffer.alloc(0);
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    if (this.socket) this.socket.destroy();
  }
  _onData(chunk) {
    if (this.ended) return;
    if (!this._pending) {
      this._abort(new Error('Unsolicited RESP2 response; Pub/Sub and push streams are not supported'));
      return;
    }
    if (chunk.length > this.config.maxResponseBytes - this._buffer.length) {
      this._abort(new RangeError('Redis response exceeds byte budget'));
      return;
    }
    this._buffer = Buffer.concat([this._buffer,chunk]);
    let reply;
    try {
      reply = resp.parse(this._buffer,{maxBytes:this.config.maxResponseBytes});
    } catch (error) {
      this._abort(error);
      return;
    }
    if (!reply) return;
    if (reply.bytes !== this._buffer.length) {
      this._abort(new Error('Unexpected extra RESP2 response bytes'));
      return;
    }
    this._buffer = Buffer.alloc(0);
    const pending = this._pending;
    this._pending = null;
    clearTimeout(pending.timer);
    if (reply.value instanceof Error) pending.reject(reply.value);
    else pending.resolve(reply.value);
  }
  _perform(encoded) {
    if (!this.socket || this.ended || this._pending) {
      return Promise.reject(new Error('Redis connection is not ready'));
    }
    return new Promise((resolve,reject) => {
      const pending = {resolve,reject,timer:null};
      this._pending = pending;
      pending.timer = setTimeout(() => this._abort(new Error('Redis command timed out')),
        this.config.commandTimeout);
      try {
        this.socket.write(encoded);
      } catch (error) {
        this._abort(error);
      }
    });
  }
  async connect() {
    if (this.connected) return this;
    if (this.ended) throw new Error('Redis connection is closed');
    if (this._connectPromise) return this._connectPromise;
    this._connectPromise = this._establish();
    try {return await this._connectPromise;}
    finally {this._connectPromise = null;}
  }
  async _establish() {
    const config = this.config;
    const secure = config.tls === true || (config.tls && typeof config.tls === 'object');
    const opts = {host:config.host,port:config.port};
    if (secure) {
      Object.assign(opts,config.tls === true ? {} : config.tls);
      opts.rejectUnauthorized = true;
      if (!opts.servername && !net.isIP(config.host)) opts.servername = config.host;
    }
    const socket = secure ? tls.connect(opts) : net.connect(opts);
    this.socket = socket;
    socket.on('data',chunk => this._onData(chunk));
    socket.on('error',error => this._abort(error));
    socket.on('close',() => this._abort(new Error('Redis transport closed')));
    try {
      await new Promise((resolve,reject) => {
        const event = secure ? 'secureConnect' : 'connect';
        const timer = setTimeout(() => finish(new Error('Redis connection timed out')),
          config.connectTimeout);
        const ready = () => {
          if (secure && socket.authorized !== true) {
            finish(new Error('Redis TLS peer verification failed'));
          } else finish();
        };
        const failed = error => finish(error);
        function finish(error) {
          clearTimeout(timer);
          socket.removeListener(event,ready);
          socket.removeListener('error',failed);
          socket.removeListener('close',closed);
          if (error) reject(error); else resolve();
        }
        const closed = () => finish(new Error('Redis transport closed before connection'));
        socket.once(event,ready);
        socket.once('error',failed);
        socket.once('close',closed);
      });
      if (config.password !== undefined) {
        const auth = config.username
          ? [config.username,config.password] : [config.password];
        try {
          const answer = await this._perform(resp.encode('AUTH',auth,config.maxCommandBytes));
          if (answer !== 'OK') throw new Error('Redis authentication failed');
        } catch (_) {
          throw new Error('Redis authentication failed');
        }
      }
      if (config.database !== undefined && config.database !== 0) {
        const result = await this._perform(resp.encode('SELECT',[config.database],config.maxCommandBytes));
        if (result !== 'OK') throw new Error('Redis SELECT failed');
      }
      if (this.ended) throw new Error('Redis transport closed');
      this.connected = true;
      return this;
    } catch (error) {
      this._abort(error);
      throw error;
    }
  }
  command(name,...args) {
    let encoded;
    try {encoded = resp.encode(name,args,this.config.maxCommandBytes);}
    catch (error) {return Promise.reject(error);}
    const current = this._queue.then(() => {
      if (!this.connected || this.ended) throw new Error('Redis connection is not ready');
      return this._perform(encoded);
    });
    this._queue = current.catch(() => {});
    return current;
  }
  ping(message) {return message === undefined ? this.command('PING') : this.command('PING',message);}
  get(key) {return this.command('GET',key);}
  set(key,value) {return this.command('SET',key,value);}
  del(...keys) {return this.command('DEL',...keys);}
  end() {
    if (!this.ended) this._abort(new Error('Redis connection closed'));
    return Promise.resolve();
  }
  close() {return this.end();}
}
module.exports = {RedisConnection,validateConfig};
