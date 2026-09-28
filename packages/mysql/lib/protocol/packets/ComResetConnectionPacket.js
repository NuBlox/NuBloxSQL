'use strict';

module.exports = ComResetConnectionPacket;

function ComResetConnectionPacket() {
  this.command = 0x1f;
}

ComResetConnectionPacket.prototype.write = function write(writer) {
  writer.writeUnsignedNumber(1, this.command);
};

ComResetConnectionPacket.prototype.parse = function parse(parser) {
  this.command = parser.parseUnsignedNumber(1);
};
