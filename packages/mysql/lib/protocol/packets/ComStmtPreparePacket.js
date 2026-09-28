'use strict';

module.exports = ComStmtPreparePacket;

function ComStmtPreparePacket(sql) {
  this.sql = sql;
}

ComStmtPreparePacket.prototype.write = function write(writer) {
  writer.writeUnsignedNumber(1, 0x16);
  writer.writeString(this.sql);
};
