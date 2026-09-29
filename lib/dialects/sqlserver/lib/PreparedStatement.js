'use strict';

var TdsPacket = require('./TdsPacket');
var Rpc = require('./Rpc');

function quoteUnicodeLiteral(value) {
  return "N'" + String(value).replace(/'/g, "''") + "'";
}

function PreparedStatement(connection, sqlText, options) {
  if (!connection) throw new TypeError('SQL Server prepared statement requires a connection');
  if (typeof sqlText !== 'string' || sqlText.length === 0) throw new TypeError('SQL Server prepared statement text must be a non-empty string');
  this.connection = connection;
  this.sqlText = sqlText;
  this.options = Object.assign({}, options || {});
  this.handle = null;
  this.closed = false;
  this._preparing = null;
}

PreparedStatement.prototype._ensurePrepared = function _ensurePrepared(values, options) {
  if (this.closed) return Promise.reject(new Error('SQL Server prepared statement is closed'));
  if (this.handle !== null) return Promise.resolve(this.handle);
  if (this._preparing) return this._preparing;
  var self = this;
  var declaration = Rpc.definitions(values || []);
  var batch = 'DECLARE @nublox_handle int; EXEC sys.sp_prepare @nublox_handle OUTPUT, ' +
    quoteUnicodeLiteral(declaration) + ', ' + quoteUnicodeLiteral(this.sqlText) +
    ', 1; SELECT @nublox_handle AS handle;';
  this._preparing = this.connection.query(batch, options || this.options).then(function (result) {
    var row = null;
    for (var i = result.rows.length - 1; i >= 0; i--) {
      if (result.rows[i] && result.rows[i].handle !== undefined) { row = result.rows[i]; break; }
    }
    var handle = row && Number(row.handle);
    if (!Number.isInteger(handle) || handle <= 0) throw new Error('SQL Server sp_prepare did not return a valid handle');
    self.handle = handle;
    return handle;
  }).finally(function () { self._preparing = null; });
  return this._preparing;
};

PreparedStatement.prototype.execute = async function execute(values, options) {
  values = values || [];
  if (!Array.isArray(values)) throw new TypeError('SQL Server prepared statement values must be an array');
  var handle = await this._ensurePrepared(values, options);
  var payload = Rpc.encodeExecutePrepared(handle, values, this.connection.transactionDescriptor);
  return this.connection._executeRequest(TdsPacket.PACKET_TYPES.RPC, payload, options || this.options);
};
PreparedStatement.prototype.query = PreparedStatement.prototype.execute;

PreparedStatement.prototype.close = async function close(options) {
  if (this.closed) return;
  this.closed = true;
  if (this._preparing) await this._preparing;
  if (this.handle === null) return;
  var handle = this.handle;
  this.handle = null;
  if (!this.connection.connected || this.connection.ended) return;
  var payload = Rpc.encodeUnprepare(handle, this.connection.transactionDescriptor);
  await this.connection._executeRequest(TdsPacket.PACKET_TYPES.RPC, payload, options || this.options);
};

exports.PreparedStatement = PreparedStatement;
exports.quoteUnicodeLiteral = quoteUnicodeLiteral;
