'use strict';

var copy = require('./CopyConnection');

function quoteIdentifier(value) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError('PostgreSQL notification channel must be a non-empty string');
  if (value.indexOf('\0') !== -1) throw new TypeError('PostgreSQL notification channel must not contain NUL');
  return '"' + value.replace(/"/g, '""') + '"';
}

function normalizePayload(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new TypeError('PostgreSQL notification payload must be a string');
  if (value.indexOf('\0') !== -1) throw new TypeError('PostgreSQL notification payload must not contain NUL');
  return value;
}

function Connection(config) {
  copy.Connection.call(this, config);
}
Connection.prototype = Object.create(copy.Connection.prototype);
Connection.prototype.constructor = Connection;

var parentHandleMessage = copy.Connection.prototype._handleMessage;
Connection.prototype._handleMessage = function _handleMessage(message) {
  if (message && message.type === 'notificationResponse') {
    var notification = Object.freeze({
      processId: message.processId,
      channel: message.channel,
      payload: message.payload
    });
    this.emit('notification', notification);
    return;
  }
  return parentHandleMessage.call(this, message);
};

Connection.prototype.listen = function listen(channel, options) {
  return this.query('LISTEN ' + quoteIdentifier(channel), options || {});
};

Connection.prototype.unlisten = function unlisten(channel, options) {
  return this.query('UNLISTEN ' + quoteIdentifier(channel), options || {});
};

Connection.prototype.unlistenAll = function unlistenAll(options) {
  return this.query('UNLISTEN *', options || {});
};

Connection.prototype.notify = function notify(channel, payload, options) {
  if (typeof channel !== 'string' || channel.length === 0) return Promise.reject(new TypeError('PostgreSQL notification channel must be a non-empty string'));
  if (channel.indexOf('\0') !== -1) return Promise.reject(new TypeError('PostgreSQL notification channel must not contain NUL'));
  var message;
  try { message = normalizePayload(payload); }
  catch (error) { return Promise.reject(error); }
  return this.execute('SELECT pg_notify($1::text, $2::text)', [channel, message], options || {});
};

exports.Connection = Connection;
exports.PreparedStatement = copy.PreparedStatement;
exports.PortalCursor = copy.PortalCursor;
exports.PostgreSqlError = copy.PostgreSqlError;
exports.PostgreSqlCancellationError = copy.PostgreSqlCancellationError;
exports.PostgreSqlResultLimitError = copy.PostgreSqlResultLimitError;
exports.DEFAULT_RESULT_LIMITS = copy.DEFAULT_RESULT_LIMITS;
exports.DEFAULT_COPY_BUFFER_BYTES = copy.DEFAULT_COPY_BUFFER_BYTES;
exports.TYPE_OIDS = copy.TYPE_OIDS;
exports.ISOLATION_LEVELS = copy.ISOLATION_LEVELS;
exports.quoteIdentifier = quoteIdentifier;
exports.normalizePayload = normalizePayload;
