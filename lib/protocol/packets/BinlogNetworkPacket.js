'use strict';

module.exports = BinlogNetworkPacket;

function BinlogNetworkPacket() {
  this.status = undefined;
  this.event = undefined;
}

BinlogNetworkPacket.prototype.parse = function parse(parser) {
  this.status = parser.parseUnsignedNumber(1);

  if (this.status !== 0x00) {
    var error = new Error('Unexpected binlog network packet status: ' + this.status);
    error.code = 'BINLOG_NETWORK_STATUS_INVALID';
    error.fatal = true;
    throw error;
  }

  this.event = parser.parsePacketTerminatedBuffer();
};
