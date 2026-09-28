'use strict';

var base = require('./Pool');
var runtime = require('./ResourceConnection');

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

exports.Pool = Pool;
