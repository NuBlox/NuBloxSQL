'use strict';

module.exports = PrepareOkPacket;

function PrepareOkPacket() {
  this.status = 0;
  this.statementId = 0;
  this.numColumns = 0;
  this.numParams = 0;
  this.warningCount = 0;
}

PrepareOkPacket.prototype.parse = function parse(parser) {
  this.status = parser.parseUnsignedNumber(1);

  if (this.status !== 0x00) {
    var error = new Error('Invalid COM_STMT_PREPARE_OK status byte: ' + this.status);
    error.code = 'PREPARED_STATEMENT_INVALID_PREPARE_OK';
    throw error;
  }

  this.statementId = parser.parseUnsignedNumber(4);
  this.numColumns = parser.parseUnsignedNumber(2);
  this.numParams = parser.parseUnsignedNumber(2);
  parser.parseFiller(1);

  if (!parser.reachedPacketEnd()) {
    this.warningCount = parser.parseUnsignedNumber(2);
  }
};
