'use strict';

var BinaryRowDataPacket = require('../packets/BinaryRowDataPacket');
var Packets = require('../packets');
var ResourceLimits = require('../ResultSetResourceLimits');
var Sequence = require('./Sequence');
var ServerStatus = require('../constants/server_status');
var Util = require('util');

module.exports = FetchCursor;
Util.inherits(FetchCursor, Sequence);

function FetchCursor(options, callback) {
  Sequence.call(this, options, callback);

  this.statementId = options.statementId;
  this.fields = options.fields || [];
  this.rowCount = options.rowCount;
  this.typeCast = options.typeCast === undefined ? true : options.typeCast;
  this.nestTables = options.nestTables || false;
  this._resultSet = {
    bufferedBytes : 0,
    bufferedRows  : 0,
    fieldPackets  : this.fields,
    rows          : []
  };
}

FetchCursor.prototype.start = function start() {
  if (!Number.isInteger(this.rowCount) || this.rowCount < 1 || this.rowCount > 0xffffffff) {
    var error = new RangeError('Cursor fetch rowCount must be an integer between 1 and 4294967295');
    error.code = 'PREPARED_CURSOR_INVALID_FETCH_SIZE';
    this.end(error);
    return;
  }

  this.emit('packet', new Packets.ComStmtFetchPacket(this.statementId, this.rowCount));
};

FetchCursor.prototype.determinePacket = function determinePacket(byte, parser) {
  if (byte === 0xff) {
    return Packets.ErrorPacket;
  }

  if (byte === 0xfe && parser.packetLength() < 9) {
    return Packets.EofPacket;
  }

  ResourceLimits.noteRowPacket(this._connection, this._resultSet, parser.packetLength(), true);
  return Packets.RowDataPacket;
};

FetchCursor.prototype.ErrorPacket = function ErrorPacket(packet) {
  this.end(this._packetToError(packet));
};

FetchCursor.prototype.RowDataPacket = function RowDataPacket(packet, parser, connection) {
  BinaryRowDataPacket.prototype.parse.call(
    packet,
    parser,
    this.fields,
    this.typeCast,
    this.nestTables,
    connection
  );
  this._resultSet.rows.push(packet);
};

FetchCursor.prototype.EofPacket = function EofPacket(packet) {
  this.end(null, this._resultSet.rows, {
    done         : Boolean(packet.serverStatus & ServerStatus.SERVER_STATUS_LAST_ROW_SENT),
    serverStatus : packet.serverStatus
  });
};
