'use strict';

var notificationPool = require('./NotificationPool');
var runtime = require('./DiagnosticsConnection');

function Pool(config) {
  notificationPool.Pool.call(this, config);
}
Pool.prototype = Object.create(notificationPool.Pool.prototype);
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

async function withConnection(pool, options, action) {
  options = options || {};
  var connection = await pool.getConnection(options.acquire);
  try { return await action(connection); }
  finally { if (pool._borrowed.has(connection)) await pool.releaseConnection(connection); }
}

Pool.prototype.explain = function explain(sql, parameters, options) {
  if (parameters && !Array.isArray(parameters) && typeof parameters === 'object' && options === undefined) {
    options = parameters;
    parameters = [];
  }
  options = options || {};
  return withConnection(this, options, function (connection) { return connection.explain(sql, parameters || [], options); });
};

Pool.prototype.explainAnalyze = function explainAnalyze(sql, parameters, options) {
  if (parameters && !Array.isArray(parameters) && typeof parameters === 'object' && options === undefined) {
    options = parameters;
    parameters = [];
  }
  options = options || {};
  return withConnection(this, options, function (connection) { return connection.explainAnalyze(sql, parameters || [], options); });
};

Pool.prototype.diagnoseQuery = function diagnoseQuery(sql, parameters, options) {
  return this.explain(sql, parameters, options);
};

exports.Pool = Pool;
exports.NotificationSubscription = notificationPool.NotificationSubscription;
