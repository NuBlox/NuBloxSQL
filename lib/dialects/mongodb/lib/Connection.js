'use strict';

const net = require('node:net');

const MAX_MS = 60000;
const MAX_RESULTS = 1000;

function positiveInteger(value, fallback, label, ceiling) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > ceiling) {
    throw new RangeError('MongoDB ' + label + ' must be an integer from 1 to ' + ceiling);
  }
  return value;
}
function validName(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 120 ||
      value.includes('\0') || value.includes('/') || value.includes('\\') ||
      value.startsWith('$')) {
    throw new TypeError('MongoDB ' + label + ' must be a valid nonempty name');
  }
  return value;
}
function isLoopback(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}
function validHost(host, label) {
  if (typeof host !== 'string' ||
      (!net.isIP(host) && !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host)) ||
      host.includes('..') || host.length > 253) {
    throw new TypeError('MongoDB ' + label + ' must be a DNS name or IP, without URL, credentials or path');
  }
  return host;
}
function hostAndPort(host, port) {
  return (net.isIP(host) === 6 ? '[' + host + ']' : host) + ':' + port;
}
function connectionUri(config) {
  if (config.srvHost) return 'mongodb+srv://' + config.srvHost + '/';
  const seeds = config.seeds || [{host:config.host,port:config.port}];
  return 'mongodb://' + seeds.map(seed => hostAndPort(seed.host,seed.port)).join(',') + '/';
}
function validateConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('MongoDB config must be an options object');
  }
  const allowed = new Set([
    'host','port','seeds','srvHost','replicaSet','database',
    'username','password','authSource',
    'tls','tlsCAFile','connectTimeout','commandTimeout','maxPoolSize','maxResults'
  ]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new TypeError('Unsupported MongoDB connection option: ' + key);
  }
  const config = Object.assign({
    host:'127.0.0.1',port:27017,connectTimeout:10000,commandTimeout:10000,
    maxPoolSize:5,maxResults:100
  },input);
  const isSrv = Object.prototype.hasOwnProperty.call(input,'srvHost');
  const isSeedlist = Object.prototype.hasOwnProperty.call(input,'seeds');
  if ((isSrv && isSeedlist) ||
      ((isSrv || isSeedlist) &&
       (Object.prototype.hasOwnProperty.call(input,'host') ||
        Object.prototype.hasOwnProperty.call(input,'port')))) {
    throw new TypeError('MongoDB topology modes are mutually exclusive');
  }
  validHost(config.host,'host');
  if (isSrv) {
    validHost(config.srvHost,'srvHost');
    if (net.isIP(config.srvHost) || config.srvHost === 'localhost' ||
        !config.srvHost.includes('.')) {
      throw new TypeError('MongoDB SRV target must be a qualified DNS hostname');
    }
    if (config.tls === false) throw new TypeError('MongoDB SRV requires verified TLS');
    config.tls = true;
  }
  if (isSeedlist) {
    if (!Array.isArray(config.seeds) || config.seeds.length < 1 || config.seeds.length > 16) {
      throw new RangeError('MongoDB replica-set seeds must be a nonempty array of at most 16 entries');
    }
    const keys = new Set();
    config.seeds = Object.freeze(config.seeds.map(entry => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
          Object.keys(entry).some(key => key !== 'host' && key !== 'port')) {
        throw new TypeError('MongoDB replica-set seed must contain only host and optional port');
      }
      const host = validHost(entry.host,'seed host');
      const port = positiveInteger(entry.port,27017,'seed port',65535);
      const unique = hostAndPort(host,port);
      if (keys.has(unique)) throw new TypeError('MongoDB duplicate seed endpoint');
      keys.add(unique);
      return Object.freeze({host,port});
    }));
    if (typeof config.replicaSet !== 'string' || !config.replicaSet) {
      throw new TypeError('MongoDB seed lists require a replicaSet name');
    }
  }
  if (config.replicaSet !== undefined &&
      (typeof config.replicaSet !== 'string' ||
       !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(config.replicaSet))) {
    throw new TypeError('MongoDB replicaSet must be a safe nonempty name');
  }
  validName(config.database,'database');
  if (config.database.includes('.')) throw new TypeError('MongoDB database cannot contain a dot');
  config.port = positiveInteger(config.port,27017,'port',65535);
  config.connectTimeout = positiveInteger(config.connectTimeout,10000,'connectTimeout',MAX_MS);
  config.commandTimeout = positiveInteger(config.commandTimeout,10000,'commandTimeout',MAX_MS);
  config.maxPoolSize = positiveInteger(config.maxPoolSize,5,'maxPoolSize',20);
  config.maxResults = positiveInteger(config.maxResults,100,'maxResults',MAX_RESULTS);
  if (config.tls !== undefined && typeof config.tls !== 'boolean') {
    throw new TypeError('MongoDB TLS must be a boolean');
  }
  const endpoints = isSrv ? [config.srvHost]
    : isSeedlist ? config.seeds.map(seed => seed.host) : [config.host];
  if (endpoints.some(host => !isLoopback(host)) && config.tls !== true) {
    throw new TypeError('MongoDB non-loopback endpoints require TLS certificate verification');
  }
  if (config.tlsCAFile !== undefined &&
      (typeof config.tlsCAFile !== 'string' || !config.tlsCAFile.trim() || config.tls !== true)) {
    throw new TypeError('MongoDB tlsCAFile requires an enabled TLS connection and a file path');
  }
  if (config.username !== undefined &&
      (typeof config.username !== 'string' || !config.username.length)) {
    throw new TypeError('MongoDB username must be a nonempty string');
  }
  if (config.password !== undefined &&
      (typeof config.password !== 'string' || !config.password.length)) {
    throw new TypeError('MongoDB password must be a nonempty string');
  }
  if ((config.username === undefined) !== (config.password === undefined)) {
    throw new TypeError('MongoDB username and password must be configured together');
  }
  if (config.authSource !== undefined) validName(config.authSource,'authSource');
  return Object.freeze(config);
}
function validatedDocument(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.isBuffer(value)) {
    throw new TypeError('MongoDB ' + label + ' must be an object');
  }
  return value;
}
function safeError(code) {
  const error = new Error('NuBloxSQL MongoDB: ' + code);
  error.code = 'NUBLOX_MONGODB_' + code;
  return error;
}
function clientOptions(config) {
  const options = {
    appName:'NuBloxSQL',
    directConnection:!(config.seeds || config.srvHost || config.replicaSet),
    retryReads:true, retryWrites:false, maxPoolSize:config.maxPoolSize,
    connectTimeoutMS:config.connectTimeout,
    serverSelectionTimeoutMS:config.connectTimeout,
    socketTimeoutMS:config.commandTimeout * 2,
    tls:config.tls === true
  };
  if (config.tlsCAFile) options.tlsCAFile=config.tlsCAFile;
  if (config.replicaSet) options.replicaSet=config.replicaSet;
  if (config.username) {
    options.auth={username:config.username,password:config.password};
    options.authSource=config.authSource || 'admin';
  }
  return options;
}

class MongoNativeConnection {
  // Internal injection permits deterministic offline contract tests without
  // installing the optional MongoDB driver in the core release test suite.
  constructor(config, dependencies = {}) {
    this.config=validateConfig(config);
    this._MongoClient=dependencies.MongoClient || null;
    this.connected=false;
    this.ended=false;
    this._client=null;
    this._connecting=null;
    this._closing=null;
  }
  async connect() {
    if (this.ended) throw safeError('CLOSED');
    if (this.connected) return this;
    if (this._connecting) return this._connecting;
    this._connecting=this._establish();
    try {return await this._connecting;}
    finally {this._connecting=null;}
  }
  async _establish() {
    let MongoClient=this._MongoClient;
    if (!MongoClient) {
      try {MongoClient=require('mongodb').MongoClient;}
      catch (_) {throw safeError('DRIVER_NOT_INSTALLED');}
    }
    if (typeof MongoClient !== 'function') throw safeError('DRIVER_INVALID');
    const uri=connectionUri(this.config);
    try {
      this._client=new MongoClient(uri,clientOptions(this.config));
      await this._client.connect();
      if (this.ended) throw safeError('CLOSED');
      this.connected=true;
      return this;
    } catch (_) {
      this.connected=false;
      this.ended=true;
      if (this._client) {
        try {await this._client.close();} catch (_) {}
      }
      throw safeError('CONNECT_FAILED');
    }
  }
  _collection(name) {
    if (!this.connected || this.ended) throw safeError('NOT_CONNECTED');
    validName(name,'collection');
    return this._client.db(this.config.database).collection(name);
  }
  async _operation(label, work) {
    try {return await work();}
    catch (_) {throw safeError(label+'_FAILED');}
  }
  async findOne(collection, filter = {}) {
    validatedDocument(filter,'filter');
    const coll=this._collection(collection);
    return this._operation('FIND_ONE',()=>coll.findOne(filter,{maxTimeMS:this.config.commandTimeout}));
  }
  _findCursor(collection, filter, options) {
    validatedDocument(filter,'filter');
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('MongoDB find options must be an object');
    }
    for (const key of Object.keys(options)) {
      if (key !== 'limit' && key !== 'batchSize') {
        throw new TypeError('Unsupported MongoDB find option: ' + key);
      }
    }
    const limit=positiveInteger(options.limit,this.config.maxResults,'find limit',this.config.maxResults);
    const batchSize=positiveInteger(options.batchSize,Math.min(limit,100),'find batchSize',limit);
    const coll=this._collection(collection);
    return coll.find(filter,{limit,batchSize,maxTimeMS:this.config.commandTimeout});
  }
  async find(collection, filter = {}, options = {}) {
    let cursor;
    try {
      cursor=this._findCursor(collection,filter,options);
    } catch (error) {
      if (error instanceof TypeError || error instanceof RangeError ||
          error.code === 'NUBLOX_MONGODB_NOT_CONNECTED') throw error;
      throw safeError('FIND_FAILED');
    }
    let output;
    try {output=await cursor.toArray();}
    catch (_) {throw safeError('FIND_FAILED');}
    finally {
      try {await cursor.close();}
      catch (_) {throw safeError('CURSOR_CLOSE_FAILED');}
    }
    return output;
  }
  async *iterate(collection, filter = {}, options = {}) {
    let cursor;
    try {
      cursor=this._findCursor(collection,filter,options);
    } catch (error) {
      if (error instanceof TypeError || error instanceof RangeError ||
          error.code === 'NUBLOX_MONGODB_NOT_CONNECTED') throw error;
      throw safeError('ITERATE_FAILED');
    }
    try {
      for await (const document of cursor) yield document;
    } catch (_) {throw safeError('ITERATE_FAILED');}
    finally {
      try {await cursor.close();}
      catch (_) {throw safeError('CURSOR_CLOSE_FAILED');}
    }
  }
  async insertOne(collection, document) {
    validatedDocument(document,'document');
    const coll=this._collection(collection);
    return this._operation('INSERT_ONE',()=>coll.insertOne(document,{maxTimeMS:this.config.commandTimeout}));
  }
  async updateOne(collection, filter, update) {
    validatedDocument(filter,'filter');
    validatedDocument(update,'update');
    const coll=this._collection(collection);
    return this._operation('UPDATE_ONE',()=>coll.updateOne(filter,update,{maxTimeMS:this.config.commandTimeout}));
  }
  async deleteOne(collection, filter) {
    validatedDocument(filter,'filter');
    const coll=this._collection(collection);
    return this._operation('DELETE_ONE',()=>coll.deleteOne(filter,{maxTimeMS:this.config.commandTimeout}));
  }
  async countDocuments(collection, filter = {}) {
    validatedDocument(filter,'filter');
    const coll=this._collection(collection);
    return this._operation('COUNT',()=>coll.countDocuments(filter,{maxTimeMS:this.config.commandTimeout}));
  }
  async close() {
    if (this._closing) return this._closing;
    this.ended=true;
    this.connected=false;
    const connecting=this._connecting;
    this._closing=(async()=>{
      // Connection may still be negotiating TLS/authentication; wait for
      // that attempt to settle before releasing its allocated client.
      if (connecting) {
        try {await connecting;} catch (_) {}
      }
      const client=this._client;
      this._client=null;
      if (client) {
        try {await client.close();}
        catch (_) {throw safeError('CLOSE_FAILED');}
      }
    })();
    return this._closing;
  }
  end() {return this.close();}
}
module.exports={MongoNativeConnection,validateConfig,clientOptions,connectionUri};
