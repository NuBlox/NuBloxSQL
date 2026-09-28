'use strict';

var Packets = require('../packets');
var Sequence = require('./Sequence');
var Util = require('util');

module.exports = CloseStatement;
Util.inherits(CloseStatement, Sequence);

function CloseStatement(options, callback) {
  Sequence.call(this, options, callback);
  this.statementId = options.statementId;
}

CloseStatement.prototype.start = function start() {
  this.emit('packet', new Packets.ComStmtClosePacket(this.statementId));
  this.end(null);
};
