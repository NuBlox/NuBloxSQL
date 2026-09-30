'use strict';

var maintenance = require('./Maintenance');

function install(Connection) {
  if (!Connection || !Connection.prototype) throw new TypeError('SQLite maintenance integration requires Connection');
  var proto = Connection.prototype;
  if (proto.__nubloxMaintenanceInstalled) return;
  Object.defineProperty(proto, '__nubloxMaintenanceInstalled', { value: true, enumerable: false });

  proto.integrityCheck = function integrityCheck(options) {
    this._assertOpen();
    return maintenance.integrityCheck(this, options);
  };
  proto.quickCheck = function quickCheck(options) {
    this._assertOpen();
    return maintenance.quickCheck(this, options);
  };
  proto.foreignKeyCheck = function foreignKeyCheck(options) {
    this._assertOpen();
    return maintenance.foreignKeyCheck(this, options);
  };
  proto.analyze = function analyze(options) {
    this._assertOpen();
    return maintenance.analyze(this, options);
  };
  proto.optimize = function optimize(options) {
    this._assertOpen();
    return maintenance.optimize(this, options);
  };
  proto.vacuum = function vacuum(options) {
    this._assertOpen();
    return maintenance.vacuum(this, options);
  };
  proto.incrementalVacuum = function incrementalVacuum(pages, database) {
    this._assertOpen();
    return maintenance.incrementalVacuum(this, pages, database);
  };
}

exports.install = install;
