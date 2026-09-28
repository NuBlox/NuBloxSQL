'use strict';

module.exports = ComStmtClosePacket;

function ComStmtClosePacket(statementId) {
  this.statementId = statementId;
}

ComStmtClosePacket.prototype.write = function write(writer) {
  writer.writeUnsignedNumber(1, 0x19);
  writer.writeUnsignedNumber(4, this.statementId);
};
