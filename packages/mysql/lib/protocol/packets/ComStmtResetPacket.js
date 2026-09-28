'use strict';

module.exports = ComStmtResetPacket;

function ComStmtResetPacket(statementId) {
  this.statementId = statementId;
}

ComStmtResetPacket.prototype.write = function write(writer) {
  writer.writeUnsignedNumber(1, 0x1a);
  writer.writeUnsignedNumber(4, this.statementId);
};
