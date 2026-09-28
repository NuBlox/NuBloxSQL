'use strict';

var Packets = require('../packets');
var Sequence = require('./Sequence');
var Util = require('util');

module.exports = Prepare;
Util.inherits(Prepare, Sequence);

function Prepare(options, callback) {
  Sequence.call(this, options, callback);

  this.sql = options.sql;
  this._prepareOk = null;
  this._parameterEof = false;
  this._columnEof = false;
  this.statement = null;
}

Prepare.prototype.start = function start() {
  this.emit('packet', new Packets.ComStmtPreparePacket(this.sql));
};

Prepare.prototype.determinePacket = function determinePacket(byte) {
  if (!this._prepareOk) {
    if (byte === 0xff) {
      return Packets.ErrorPacket;
    }

    return Packets.PrepareOkPacket;
  }

  if (byte === 0xff) {
    return Packets.ErrorPacket;
  }

  if (this.statement.parameters.length < this.statement.numParams) {
    return Packets.FieldPacket;
  }

  if (this.statement.numParams > 0 && !this._parameterEof) {
    return Packets.EofPacket;
  }

  if (this.statement.columns.length < this.statement.numColumns) {
    return Packets.FieldPacket;
  }

  return Packets.EofPacket;
};

Prepare.prototype.PrepareOkPacket = function PrepareOkPacket(packet) {
  this._prepareOk = packet;
  this.statement = {
    id           : packet.statementId,
    sql          : this.sql,
    numColumns   : packet.numColumns,
    numParams    : packet.numParams,
    warningCount : packet.warningCount,
    parameters   : [],
    columns      : []
  };

  if (packet.numParams === 0 && packet.numColumns === 0) {
    this.end(null, this.statement);
  }
};

Prepare.prototype.FieldPacket = function FieldPacket(packet) {
  if (this.statement.parameters.length < this.statement.numParams) {
    this.statement.parameters.push(packet);
    return;
  }

  this.statement.columns.push(packet);
};

Prepare.prototype.EofPacket = function EofPacket() {
  if (this.statement.numParams > 0 && !this._parameterEof) {
    this._parameterEof = true;

    if (this.statement.numColumns === 0) {
      this.end(null, this.statement);
    }
    return;
  }

  this._columnEof = true;
  this.end(null, this.statement);
};

Prepare.prototype.ErrorPacket = function ErrorPacket(packet) {
  var error = this._packetToError(packet);
  error.sql = this.sql;
  this.end(error);
};
