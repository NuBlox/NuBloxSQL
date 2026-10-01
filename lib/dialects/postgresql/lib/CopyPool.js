'use strict';

var base = require('./Pool');
var runtime = require('./CopyConnection');

function Pool(config) {
  base.Pool.call(this, config);
}
Pool.prototype = Object.create(base.Pool.prototype);
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

Pool.prototype.copyFrom = async function copyFrom(sql, source, options) {
  options = options || {};
  var connection = await this.getConnection(options.acquire);
  try { return await connection.copyFrom(sql, source, options); }
  finally { if (this._borrowed.has(connection)) await this.releaseConnection(connection); }
};

Pool.prototype.copyTo = async function copyTo(sql, options) {
  options = options || {};
  var connection = await this.getConnection(options.acquire);
  try { return await connection.copyTo(sql, options); }
  finally { if (this._borrowed.has(connection)) await this.releaseConnection(connection); }
};

exports.Pool = Pool;
