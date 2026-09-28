'use strict';

var Packets  = require('../packets');
var Sequence = require('./Sequence');
var Util     = require('util');

module.exports = ResetConnection;
Util.inherits(ResetConnection, Sequence);

function ResetConnection(options, callback) {
  Sequence.call(this, options, callback);
}

ResetConnection.prototype.start = function start() {
  this.emit('packet', new Packets.ComResetConnectionPacket());
};
