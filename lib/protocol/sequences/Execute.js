'use strict';

var BinaryRowDataPacket = require('../packets/BinaryRowDataPacket');
var Packets = require('../packets');
var ResultSet = require('../ResultSet');
var ResourceLimits = require('../ResultSetResourceLimits');
var Sequence = require('./Sequence');
var Util = require('util');

module.exports = Execute;
Util.inherits(Execute, Sequence);

function Execute(options, callback) {
  Sequence.call(this, options, callback);

  this.statement = options.statement;
  this.values = options.values || [];
  this.typeCast = options.typeCast === undefined ? true : options.typeCast;
  this.nestTables = options.nestTables || false;
  this._resultSet = null;
}

Execute.prototype.start = function start() {
  if (this.values.length !== this.statement.numParams) {
    var error = new Error(
      'Prepared statement expected ' + this.statement.numParams +
      ' parameters but received ' + this.values.length
    );
    error.code = 'PREPARED_STATEMENT_PARAMETER_COUNT_MISMATCH';
    this.end(error);
    return;
  }

  this.emit('packet', new Packets.ComStmtExecutePacket(this.statement.id, this.values));
};

Execute.prototype.determinePacket = function determinePacket(byte, parser) {
  if (!this._resultSet) {
    if (byte === 0x00) {
      return Packets.OkPacket;
    }

    if (byte === 0xff) {
      return Packets.ErrorPacket;
    }

    return Packets.ResultSetHeaderPacket;
  }

  if (this._resultSet.eofPackets.length === 0) {
    if (this._resultSet.fieldPackets.length < this._resultSet.resultSetHeaderPacket.fieldCount) {
      ResourceLimits.noteMetadataPacket(this._connection, this._resultSet, parser.packetLength());
      return Packets.FieldPacket;
    }

    return Packets.EofPacket;
  }

  if (byte === 0xff) {
    return Packets.ErrorPacket;
  }

  if (byte === 0xfe && parser.packetLength() < 9) {
    return Packets.EofPacket;
  }

  ResourceLimits.noteRowPacket(this._connection, this._resultSet, parser.packetLength(), true);
  return Packets.RowDataPacket;
};

Execute.prototype.OkPacket = function OkPacket(packet) {
  this.end(null, packet, undefined);
};

Execute.prototype.ErrorPacket = function ErrorPacket(packet) {
  var error = this._packetToError(packet);
  error.sql = this.statement.sql;
  this.end(error);
};

Execute.prototype.ResultSetHeaderPacket = function ResultSetHeaderPacket(packet) {
  ResourceLimits.assertColumnCount(this._connection, packet.fieldCount);
  this._resultSet = new ResultSet(packet);
};

Execute.prototype.FieldPacket = function FieldPacket(packet) {
  this._resultSet.fieldPackets.push(packet);
};

Execute.prototype.EofPacket = function EofPacket(packet) {
  this._resultSet.eofPackets.push(packet);

  if (this._resultSet.eofPackets.length !== 2) {
    return;
  }

  this.end(null, this._resultSet.rows, this._resultSet.fieldPackets);
};

Execute.prototype.RowDataPacket = function RowDataPacket(packet, parser, connection) {
  BinaryRowDataPacket.prototype.parse.call(
    packet,
    parser,
    this._resultSet.fieldPackets,
    this.typeCast,
    this.nestTables,
    connection
  );
  this._resultSet.rows.push(packet);
};
