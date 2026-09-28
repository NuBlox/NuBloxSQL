module.exports = AuthMoreDataPacket;

function AuthMoreDataPacket(options) {
  options = options || {};

  this.status         = 0x01;
  this.data           = options.data;
  this.expectResponse = options.expectResponse || false;
}

AuthMoreDataPacket.prototype.parse = function parse(parser) {
  this.status = parser.parseUnsignedNumber(1);
  this.data   = parser.parsePacketTerminatedBuffer();
};

AuthMoreDataPacket.prototype.write = function write(writer) {
  writer.writeUnsignedNumber(1, this.status);

  if (this.data) {
    writer.writeBuffer(this.data);
  }
};
