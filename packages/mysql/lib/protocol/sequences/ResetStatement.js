'use strict';

var Packets = require('../packets');
var Sequence = require('./Sequence');
var Util = require('util');

module.exports = ResetStatement;
Util.inherits(ResetStatement, Sequence);

function ResetStatement(options, callback) {
  Sequence.call(this, options, callback);
  this.statementId = options.statementId;
}

ResetStatement.prototype.start = function start() {
  this.emit('packet', new Packets.ComStmtResetPacket(this.statementId));
};
