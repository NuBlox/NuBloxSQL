'use strict';

var maintenance = require('./Maintenance');

function install(Connection) {
  if (!Connection || !Connection.prototype) throw new TypeError('SQLite maintenance integration requires Connection');
  var proto = Connection.prototype;
  if (proto.__nubloxMaintenanceInstalled) return;
  Object.defineProperty(proto, '__nubloxMaintenanceInstalled', { value: true, enumerable: false });

  proto.integrityCheck = function integrityCheck(options) {
    this._assertOpen();
    try { return maintenance.integrityCheck(this._database, options); }
    catch (error) { throw error; }
  };
  proto.quickCheck = function quickCheck(options) {
    this._assertOpen();
    return maintenance.quickCheck(this._database, options);
  };
  proto.foreignKeyCheck = function foreignKeyCheck(options) {
    this._assertOpen();
    return maintenance.foreignKeyCheck(this._database, options);
  };
  proto.analyze = function analyze(options) {
    this._assertOpen();
    return maintenance.analyze(this._database, options);
  };
  proto.optimize = function optimize(options) {
    this._assertOpen();
    return maintenance.optimize(this._database, options);
  };
  proto.vacuum = function vacuum(options) {
    this._assertOpen();
    return maintenance.vacuum(this._database, options);
  };
  proto.incrementalVacuum = function incrementalVacuum(pages, database) {
    this._assertOpen();
    return maintenance.incrementalVacuum(this._database, pages, database);
  };
}

exports.install = install;
