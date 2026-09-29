'use strict';

var TdsPacket = require('./TdsPacket');
var AllHeaders = require('./AllHeaders');
var Rpc = require('./Rpc');
var RowStream = require('./RowStream').RowStream;

function install(Connection, SqlServerError) {
  if (!Connection || !Connection.prototype || Connection.prototype.queryStream) return;

  function controlError(kind, cause) {
    return new SqlServerError(kind === 'cancelled' ? 'SQL Server operation was cancelled' : 'SQL Server operation timed out', {
      code: kind === 'cancelled' ? 'NUBLOX_SQLSERVER_CANCELLED' : 'NUBLOX_SQLSERVER_TIMEOUT',
      category: kind,
      retryable: kind === 'timeout',
      cause: cause || undefined,
      native: cause || null
    });
  }
  function helpers() { return { SqlServerError: SqlServerError, controlError: controlError }; }

  Connection.prototype.queryStream = function queryStream(sqlText, options) {
    if (typeof sqlText !== 'string' || sqlText.length === 0) throw new TypeError('SQL Server streaming query text must be a non-empty string');
    return new RowStream(this, TdsPacket.PACKET_TYPES.SQL_BATCH, AllHeaders.sqlBatch(sqlText, this.transactionDescriptor), options || {}, helpers());
  };
  Connection.prototype.queryParametersStream = function queryParametersStream(sqlText, values, options) {
    return new RowStream(this, TdsPacket.PACKET_TYPES.RPC, Rpc.encodeExecuteSql(sqlText, values, this.transactionDescriptor), options || {}, helpers());
  };
}

exports.install = install;
