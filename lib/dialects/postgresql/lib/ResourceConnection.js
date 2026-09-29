'use strict';

var portal = require('./PortalConnection');
var limits = require('./ResultLimits');
var types = require('./TypeDecoder');

function Connection(config) {
  portal.Connection.call(this, config);
  config = config || {};
  var defaults = limits.create(config, {});
  this.maxRows = defaults.maxRows;
  this.maxResultBytes = defaults.maxResultBytes;
  this.maxRowBytes = defaults.maxRowBytes;
}
Connection.prototype = Object.create(portal.Connection.prototype);
Connection.prototype.constructor = Connection;

var baseStartOperation = portal.Connection.prototype._startOperation;
Connection.prototype._startOperation = function _startOperation(state, messages, options) {
  state._resultLimits = limits.create({
    maxRows: this.maxRows,
    maxResultBytes: this.maxResultBytes,
    maxRowBytes: this.maxRowBytes
  }, options || {});
  return baseStartOperation.call(this, state, messages, options || {});
};

Connection.prototype._decodeRow = function _decodeRow(message, state) {
  limits.observeRow(state, message);
  var row = Object.create(null);
  var fields = state.fields || [];
  for (var i = 0; i < message.values.length; i++) {
    var field = fields[i] || { name: String(i) };
    row[field.name] = types.decodeText(field, message.values[i]);
  }
  state.rows.push(row);
};

exports.Connection = Connection;
exports.PreparedStatement = portal.PreparedStatement;
exports.PortalCursor = portal.PortalCursor;
exports.PostgreSqlError = portal.PostgreSqlError;
exports.PostgreSqlCancellationError = portal.PostgreSqlCancellationError;
exports.PostgreSqlResultLimitError = limits.PostgreSqlResultLimitError;
exports.DEFAULT_RESULT_LIMITS = limits.DEFAULTS;
exports.TYPE_OIDS = types.OID;
