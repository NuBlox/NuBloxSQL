'use strict';

var NegotiatedClientFlags = require('../NegotiatedClientFlags');
var Packets = require('../packets');
var ResourceLimits = require('../ResultSetResourceLimits');
var ResultSet = require('../ResultSet');
var Sequence = require('./Sequence');
var ServerStatus = require('../constants/server_status');
var Util = require('util');

module.exports = OpenCursor;
Util.inherits(OpenCursor, Sequence);

function OpenCursor(options, callback) {
  Sequence.call(this, options, callback);

  this.statement = options.statement;
  this.values = options.values || [];
  this.attributes = options.attributes || {};
  this._resultSet = null;
}

OpenCursor.prototype.start = function start() {
  if (this.values.length !== this.statement.numParams) {
    var error = new Error(
      'Prepared statement expected ' + this.statement.numParams +
      ' parameters but received ' + this.values.length
    );
    error.code = 'PREPARED_STATEMENT_PARAMETER_COUNT_MISMATCH';
    this.end(error);
    return;
  }

  var clientFlags = NegotiatedClientFlags.forCommand(this._connection);

  this.emit('packet', new Packets.ComStmtExecutePacket(
    this.statement.id,
    this.values,
    this.attributes,
    clientFlags,
    0x01
  ));
};

OpenCursor.prototype.determinePacket = function determinePacket(byte, parser) {
  if (!this._resultSet) {
    if (byte === 0x00) {
      return Packets.OkPacket;
    }

    if (byte === 0xff) {
      return Packets.ErrorPacket;
    }

    return Packets.ResultSetHeaderPacket;
  }

  if (this._resultSet.fieldPackets.length < this._resultSet.resultSetHeaderPacket.fieldCount) {
    ResourceLimits.noteMetadataPacket(this._connection, this._resultSet, parser.packetLength());
    return Packets.FieldPacket;
  }

  return Packets.EofPacket;
};

OpenCursor.prototype.OkPacket = function OkPacket() {
  var error = new Error('Server-side cursors require a prepared statement that returns a result set');
  error.code = 'PREPARED_CURSOR_RESULTSET_REQUIRED';
  this.end(error);
};

OpenCursor.prototype.ErrorPacket = function ErrorPacket(packet) {
  var error = this._packetToError(packet);
  error.sql = this.statement.sql;
  this.end(error);
};

OpenCursor.prototype.ResultSetHeaderPacket = function ResultSetHeaderPacket(packet) {
  ResourceLimits.assertColumnCount(this._connection, packet.fieldCount);
  this._resultSet = new ResultSet(packet);
};

OpenCursor.prototype.FieldPacket = function FieldPacket(packet) {
  this._resultSet.fieldPackets.push(packet);
};

OpenCursor.prototype.EofPacket = function EofPacket(packet) {
  if (!(packet.serverStatus & ServerStatus.SERVER_STATUS_CURSOR_EXISTS)) {
    var error = new Error('MySQL did not open the requested server-side cursor');
    error.code = 'PREPARED_CURSOR_NOT_OPENED';
    error.serverStatus = packet.serverStatus;
    this.end(error);
    return;
  }

  this.end(null, this._resultSet.fieldPackets, packet.serverStatus);
};
