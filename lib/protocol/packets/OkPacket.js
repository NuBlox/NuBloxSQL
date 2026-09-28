var ClientConstants = require('../constants/client');
var ServerStatus = require('../constants/server_status');
var SessionState = require('../SessionState');

// Language-neutral expression to match ER_UPDATE_INFO
var ER_UPDATE_INFO_REGEXP = /^[^:0-9]+: [0-9]+[^:0-9]+: ([0-9]+)[^:0-9]+: [0-9]+[^:0-9]*$/;

module.exports = OkPacket;
function OkPacket(options) {
  options = options || {};

  this.fieldCount          = undefined;
  this.affectedRows        = undefined;
  this.insertId            = undefined;
  this.serverStatus        = undefined;
  this.warningCount        = undefined;
  this.message             = undefined;
  this.sessionStateChanges = [];
  this.clientFlags         = options.clientFlags || 0;
  this.protocol41          = (options.protocol41 === undefined)
    ? true
    : options.protocol41;
}

OkPacket.prototype.parse = function(parser) {
  this.fieldCount   = parser.parseUnsignedNumber(1);
  this.affectedRows = parser.parseLengthCodedNumber();
  this.insertId     = parser.parseLengthCodedNumber();
  if (this.protocol41) {
    this.serverStatus = parser.parseUnsignedNumber(2);
    this.warningCount = parser.parseUnsignedNumber(2);
  }

  if (this.clientFlags & ClientConstants.CLIENT_SESSION_TRACK) {
    this.message = parser.reachedPacketEnd()
      ? ''
      : (parser.parseLengthCodedString() || '');

    if (this.serverStatus & ServerStatus.SERVER_SESSION_STATE_CHANGED) {
      if (parser.reachedPacketEnd()) {
        throw sessionStateProtocolError('OK packet advertised session-state changes without a state payload');
      }

      var state = parser.parseLengthCodedBuffer();
      this.sessionStateChanges = SessionState.parse(state || require('safe-buffer').Buffer.alloc(0));
    }

    if (!parser.reachedPacketEnd()) {
      throw sessionStateProtocolError('Unexpected trailing bytes after OK packet session state');
    }
  } else {
    this.message = parser.parsePacketTerminatedString();
  }

  this.changedRows = 0;

  var m = ER_UPDATE_INFO_REGEXP.exec(this.message);
  if (m !== null) {
    this.changedRows = parseInt(m[1], 10);
  }
};

OkPacket.prototype.write = function(writer) {
  writer.writeUnsignedNumber(1, 0x00);
  writer.writeLengthCodedNumber(this.affectedRows || 0);
  writer.writeLengthCodedNumber(this.insertId || 0);
  if (this.protocol41) {
    writer.writeUnsignedNumber(2, this.serverStatus || 0);
    writer.writeUnsignedNumber(2, this.warningCount || 0);
  }
  writer.writeString(this.message);
};

function sessionStateProtocolError(message) {
  var error = new Error(message);
  error.code = 'PARSER_SESSION_STATE_INVALID';
  error.fatal = true;
  return error;
}
