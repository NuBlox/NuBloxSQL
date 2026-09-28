'use strict';

var transaction = require('./TransactionConnection');
var client = require('./protocol/ClientPackets');

function Connection(config) {
  transaction.Connection.call(this, config);
}
Connection.prototype = Object.create(transaction.Connection.prototype);
Connection.prototype.constructor = Connection;

Connection.prototype.resetSession = function resetSession(options) {
  var self = this;
  var state = { phase: 'start' };
  return this._startOperation('session-reset', state, client.encodeResetConnection(), options || {}).then(function (result) {
    self.inTransaction = false;
    self.emit('reset');
    return result;
  });
};

exports.Connection = Connection;
exports.PreparedStatement = transaction.PreparedStatement;
exports.ISOLATION_LEVELS = transaction.ISOLATION_LEVELS;
