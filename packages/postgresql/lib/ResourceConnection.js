'use strict';

var portal = require('./PortalConnection');
var limits = require('./ResultLimits');

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

var baseDecodeRow = portal.Connection.prototype._decodeRow;
Connection.prototype._decodeRow = function _decodeRow(message, state) {
  limits.observeRow(state, message);
  return baseDecodeRow.call(this, message, state);
};

exports.Connection = Connection;
exports.PreparedStatement = portal.PreparedStatement;
exports.PortalCursor = portal.PortalCursor;
exports.PostgreSqlError = portal.PostgreSqlError;
exports.PostgreSqlCancellationError = portal.PostgreSqlCancellationError;
exports.PostgreSqlResultLimitError = limits.PostgreSqlResultLimitError;
exports.DEFAULT_RESULT_LIMITS = limits.DEFAULTS;
