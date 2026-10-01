'use strict';

var control = require('./OperationControl');

function install(poolModule) {
  if (!poolModule || !poolModule.Pool) return;
  var Pool = poolModule.Pool;
  if (Pool.prototype.loadDataLocal) return;

  Pool.prototype.loadDataLocal = async function loadDataLocal(sql, source, options) {
    options = control.deriveTotalDeadline(options || {}, 'MySQL pool LOCAL INFILE');
    var connection = await this.getConnection(control.acquisitionOptions(options));
    try {
      return await connection.loadDataLocal(sql, source, options);
    } finally {
      if (this._all.has(connection) && !connection.ended && !connection.inTransaction && !connection._queryState) {
        this.releaseConnection(connection);
      }
    }
  };
}

exports.install = install;
