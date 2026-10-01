'use strict';

var EventEmitter = require('events').EventEmitter;
var copyPool = require('./CopyPool');
var runtime = require('./NotificationConnection');

function NotificationSubscription(pool, connection, channel) {
  EventEmitter.call(this);
  this.pool = pool;
  this.connection = connection;
  this.channel = channel;
  this.closed = false;
  var self = this;
  this._handler = function (notification) {
    if (notification.channel === self.channel) self.emit('notification', notification);
  };
  connection.on('notification', this._handler);
}
NotificationSubscription.prototype = Object.create(EventEmitter.prototype);
NotificationSubscription.prototype.constructor = NotificationSubscription;

NotificationSubscription.prototype.close = async function close(options) {
  if (this.closed) return;
  this.closed = true;
  this.connection.removeListener('notification', this._handler);
  var failure = null;
  try {
    if (this.connection.connected && !this.connection.ended) await this.connection.unlisten(this.channel, options || {});
  } catch (error) {
    failure = error;
    if (!this.connection.ended) this.connection.destroy(error);
  } finally {
    if (this.pool._borrowed.has(this.connection)) await this.pool.releaseConnection(this.connection);
  }
  if (failure) throw failure;
};

function Pool(config) {
  copyPool.Pool.call(this, config);
}
Pool.prototype = Object.create(copyPool.Pool.prototype);
Pool.prototype.constructor = Pool;

Pool.prototype._create = async function _create() {
  var self = this;
  var connection = new runtime.Connection(this._connectionConfig());
  this._all.add(connection);
  connection.once('close', function () { self._remove(connection); self._drain(); });
  try {
    await connection.connect();
    this.emit('connection', connection);
    return connection;
  } catch (error) {
    this._remove(connection);
    throw error;
  }
};

Pool.prototype.listen = async function listen(channel, options) {
  options = options || {};
  var connection = await this.getConnection(options.acquire);
  try {
    await connection.listen(channel, options);
    return new NotificationSubscription(this, connection, channel);
  } catch (error) {
    if (this._borrowed.has(connection)) await this.releaseConnection(connection);
    throw error;
  }
};

Pool.prototype.notify = async function notify(channel, payload, options) {
  options = options || {};
  var connection = await this.getConnection(options.acquire);
  try { return await connection.notify(channel, payload, options); }
  finally { if (this._borrowed.has(connection)) await this.releaseConnection(connection); }
};

exports.Pool = Pool;
exports.NotificationSubscription = NotificationSubscription;
