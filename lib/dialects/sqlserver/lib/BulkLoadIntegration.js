'use strict';

var TdsPacket = require('./TdsPacket');
var BulkLoad = require('./BulkLoad');

function install(Connection, Pool) {
  if (!Connection || !Connection.prototype || !Pool || !Pool.prototype) return;

  if (!Connection.prototype.bulkInsert) {
    Connection.prototype.bulkInsert = async function bulkInsert(tableParts, columnNames, rows, options) {
      options = options || {};
      var plan = BulkLoad.build(tableParts, columnNames, rows);
      if (!plan) return null;

      await this.query(plan.statement, options);
      var result = await this._executeRequest(TdsPacket.PACKET_TYPES.BULK_LOAD, plan.payload, options);
      return Object.freeze({
        rowCount: BigInt(plan.rowCount),
        affectedRows: BigInt(plan.rowCount),
        columns: plan.columns,
        native: result
      });
    };
  }

  if (!Pool.prototype.bulkInsert) {
    Pool.prototype.bulkInsert = async function bulkInsert(tableParts, columnNames, rows, options) {
      options = options || {};
      var connection = await this.getConnection(options.acquire || {});
      try {
        return await connection.bulkInsert(tableParts, columnNames, rows, options);
      } finally {
        if (this._borrowed && this._borrowed.has(connection)) await this.releaseConnection(connection);
      }
    };
  }
}

exports.install = install;
