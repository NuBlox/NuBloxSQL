'use strict';

module.exports = ComStmtFetchPacket;

function ComStmtFetchPacket(statementId, rowCount) {
  this.statementId = statementId;
  this.rowCount = rowCount;
}

ComStmtFetchPacket.prototype.write = function write(writer) {
  writer.writeUnsignedNumber(1, 0x1c);
  writer.writeUnsignedNumber(4, this.statementId);
  writer.writeUnsignedNumber(4, this.rowCount);
};
