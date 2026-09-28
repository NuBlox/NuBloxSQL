'use strict';

var Readable = require('stream').Readable;

function positiveInteger(value, fallback, name) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(name + ' must be a positive integer');
  return value;
}

function ResultStream(connection, state, options) {
  options = options || {};
  Readable.call(this, {
    objectMode: true,
    highWaterMark: positiveInteger(options.highWaterMark, 16, 'MySQL result stream highWaterMark')
  });
  this.connection = connection;
  this.fields = null;
  this.affectedRows = 0;
  this.insertId = 0;
  this.serverStatus = 0;
  this.warningCount = 0;
  this.rowCount = 0;
  this.byteCount = 0;
  this._state = state;
}
ResultStream.prototype = Object.create(Readable.prototype);
ResultStream.prototype.constructor = ResultStream;

ResultStream.prototype._read = function _read() {
  if (this.connection && this.connection.socket && !this.connection.socket.destroyed) this.connection.socket.resume();
};

ResultStream.prototype._destroy = function _destroy(error, callback) {
  var connection = this.connection;
  if (connection && connection._queryState === this._state && !connection.ended) {
    connection.destroy(error || new Error('MySQL result stream destroyed before completion'));
  }
  callback(error || null);
};

ResultStream.prototype._setFields = function _setFields(fields) {
  this.fields = fields;
  this.emit('fields', fields);
};

ResultStream.prototype._pushRow = function _pushRow(row, packetBytes) {
  this.rowCount += 1;
  this.byteCount += packetBytes;
  if (!this.push(row) && this.connection && this.connection.socket) this.connection.socket.pause();
};

ResultStream.prototype._complete = function _complete(serverStatus, warningCount) {
  this.serverStatus = serverStatus;
  this.warningCount = warningCount;
  this.push(null);
};

ResultStream.prototype._completeCommand = function _completeCommand(ok) {
  this.fields = [];
  this.affectedRows = ok.affectedRows;
  this.insertId = ok.lastInsertId;
  this.serverStatus = ok.statusFlags;
  this.warningCount = ok.warnings;
  this.emit('result', {
    affectedRows: this.affectedRows,
    insertId: this.insertId,
    serverStatus: this.serverStatus,
    warningCount: this.warningCount
  });
  this.push(null);
};

exports.ResultStream = ResultStream;
