'use strict';

var errorApi = require('./Error');

var streamsByClient = new WeakMap();

function streamSet(client) {
  var set = streamsByClient.get(client);
  if (!set) {
    set = new Set();
    streamsByClient.set(client, set);
  }
  return set;
}

function withoutStreamControl(options) {
  var out = Object.assign({}, options || {});
  delete out.batchSize;
  delete out.acquire;
  return out;
}

function ClientRowStream(client, statement, options) {
  this.client = client;
  this.dialect = client.dialect;
  this.options = options || {};
  this.compiled = client.compile(statement);
  this.native = null;
  this.closed = false;
  this.fields = null;
  this._initialized = false;
  this._initializing = null;
  this._iterator = null;
  this._connection = null;
  this._statement = null;
  this._cursor = null;
  this._pool = null;
  this._autoTransaction = false;
  this._pgRows = [];
  this._pgIndex = 0;
  streamSet(client).add(this);
}

ClientRowStream.prototype[Symbol.asyncIterator] = function iterator() { return this; };

ClientRowStream.prototype._ensure = function _ensure() {
  if (this._initialized) return Promise.resolve();
  if (this._initializing) return this._initializing;
  var self = this;
  this._initializing = this._initialize().then(function () {
    self._initialized = true;
    self._initializing = null;
  }, function (error) {
    self._initializing = null;
    throw error;
  });
  return this._initializing;
};

ClientRowStream.prototype._acquireConnection = async function _acquireConnection() {
  if (this.client._isPool) {
    this._pool = this.client._target;
    this._connection = await this._pool.getConnection(this.options.acquire || {});
  } else {
    this._connection = await this.client._ensureConnected();
  }
  return this._connection;
};

ClientRowStream.prototype._initialize = async function _initialize() {
  var connection;
  var nativeOptions = withoutStreamControl(this.options);

  if (this.dialect === 'mysql') {
    connection = await this._acquireConnection();
    if (this.compiled.parameters.length) {
      this._statement = await connection.prepare(this.compiled.text, nativeOptions);
      this.native = this._statement.stream(this.compiled.parameters, nativeOptions);
    } else {
      this.native = connection.queryStream(this.compiled.text, nativeOptions);
    }
    this._iterator = this.native[Symbol.asyncIterator]();
    return;
  }

  if (this.dialect === 'postgresql') {
    connection = await this._acquireConnection();
    if (connection.transactionStatus !== 'T') {
      await connection.beginTransaction(Object.assign({}, nativeOptions, { readOnly: true }));
      this._autoTransaction = true;
    }
    this._statement = await connection.prepare(this.compiled.text, nativeOptions);
    this._cursor = this._statement.openCursor(this.compiled.parameters, {
      batchSize: this.options.batchSize
    });
    this.native = this._cursor;
    return;
  }

  if (this.dialect === 'sqlite') {
    connection = await this._acquireConnection();
    this._statement = connection.prepare(this.compiled.text, nativeOptions);
    this.native = this._statement.iterate(this.compiled.parameters);
    this._iterator = this.native[Symbol.iterator]();
    return;
  }

  throw errorApi.unsupportedError(this.dialect, 'streaming');
};

ClientRowStream.prototype._nextPostgreSql = async function _nextPostgreSql() {
  while (this._pgIndex >= this._pgRows.length) {
    if (!this._cursor || this._cursor.done) return { done: true, value: undefined };
    var batch = await this._cursor.fetch(withoutStreamControl(this.options));
    this.fields = batch.fields || this.fields;
    this._pgRows = batch.rows || [];
    this._pgIndex = 0;
    if (!this._pgRows.length && batch.done) return { done: true, value: undefined };
  }
  return { done: false, value: this._pgRows[this._pgIndex++] };
};

ClientRowStream.prototype.next = async function next() {
  if (this.closed) return { done: true, value: undefined };
  try {
    await this._ensure();
    var item;
    if (this.dialect === 'postgresql') item = await this._nextPostgreSql();
    else item = await Promise.resolve(this._iterator.next());
    if (this.native && this.native.fields) this.fields = this.native.fields;
    if (item.done) await this._cleanup(true);
    return item;
  } catch (error) {
    try { await this._cleanup(false); } catch (cleanupError) { if (error && error.cleanupError === undefined) error.cleanupError = cleanupError; }
    throw errorApi.normalizeError(this.dialect, error, 'stream');
  }
};

ClientRowStream.prototype.return = async function closeEarly() {
  await this.close();
  return { done: true, value: undefined };
};

ClientRowStream.prototype.throw = async function throwInto(error) {
  try { await this._cleanup(false); }
  catch (cleanupError) { if (error && error.cleanupError === undefined) error.cleanupError = cleanupError; }
  throw error;
};

ClientRowStream.prototype.close = async function close() {
  if (this.closed) return;
  var firstError = null;
  if (this._iterator && typeof this._iterator.return === 'function' && this.dialect !== 'postgresql') {
    try { await Promise.resolve(this._iterator.return()); }
    catch (error) { firstError = error; }
  }
  try { await this._cleanup(firstError === null); }
  catch (error) { if (!firstError) firstError = error; }
  if (firstError) throw errorApi.normalizeError(this.dialect, firstError, 'stream.close');
};

ClientRowStream.prototype._cleanup = async function _cleanup(success) {
  if (this.closed) return;
  this.closed = true;
  streamSet(this.client).delete(this);
  var firstError = null;

  if (this._cursor && !this._cursor.closed) {
    try { await this._cursor.close(withoutStreamControl(this.options)); }
    catch (error) { firstError = firstError || error; success = false; }
  }
  if (this._statement && typeof this._statement.close === 'function' && !this._statement.closed) {
    try { await this._statement.close(withoutStreamControl(this.options)); }
    catch (error) { firstError = firstError || error; success = false; }
  }

  if (this._autoTransaction && this._connection && !this._connection.ended) {
    try {
      if (success && this._connection.transactionStatus === 'T') await this._connection.commit();
      else if (this._connection.transactionStatus === 'T' || this._connection.transactionStatus === 'E') await this._connection.rollback();
    } catch (error) {
      firstError = firstError || error;
      if (this._connection && typeof this._connection.destroy === 'function') this._connection.destroy(error);
    }
  }

  if (this._pool && this._connection) {
    try {
      var belongs = !this._pool._all || this._pool._all.has(this._connection);
      var borrowed = !this._pool._borrowed || this._pool._borrowed.has(this._connection);
      if (belongs && borrowed && !this._connection.ended) await this._pool.releaseConnection(this._connection);
    } catch (error) { firstError = firstError || error; }
  }

  if (firstError) throw firstError;
};

function install(clientApi) {
  if (!clientApi || !clientApi.Client || clientApi.Client.prototype.stream) return;
  clientApi.Client.prototype.stream = function stream(statement, options) {
    return new ClientRowStream(this, statement, options || {});
  };

  var originalClose = clientApi.Client.prototype.close;
  clientApi.Client.prototype.close = async function closeWithStreams() {
    var streams = Array.from(streamSet(this));
    var firstError = null;
    for (var i = 0; i < streams.length; i++) {
      try { await streams[i].close(); }
      catch (error) { if (!firstError) firstError = error; }
    }
    try { await originalClose.call(this); }
    catch (error) { if (!firstError) firstError = error; }
    if (firstError) throw firstError;
  };
}

exports.ClientRowStream = ClientRowStream;
exports.install = install;
