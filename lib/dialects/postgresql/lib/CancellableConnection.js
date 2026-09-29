'use strict';

var base = require('./Connection');
var cancel = require('./CancelRequest');

function PostgreSqlCancellationError(message, code) {
  Error.call(this, message);
  this.name = 'PostgreSqlCancellationError';
  this.message = message;
  this.code = code || 'NUBLOX_POSTGRESQL_CANCELLED';
  if (Error.captureStackTrace) Error.captureStackTrace(this, PostgreSqlCancellationError);
}
PostgreSqlCancellationError.prototype = Object.create(Error.prototype);
PostgreSqlCancellationError.prototype.constructor = PostgreSqlCancellationError;

function cancellationError(message, code) {
  return new PostgreSqlCancellationError(message, code);
}

function Connection(config) {
  base.Connection.call(this, config);
  var grace = config && config.cancelGraceTimeout;
  this.cancelGraceTimeout = grace === undefined ? 5000 : Number(grace);
  if (!Number.isFinite(this.cancelGraceTimeout) || this.cancelGraceTimeout <= 0) throw new RangeError('PostgreSQL cancelGraceTimeout must be a positive number');
}
Connection.prototype = Object.create(base.Connection.prototype);
Connection.prototype.constructor = Connection;

Connection.prototype._requestOperationCancel = function _requestOperationCancel(state, reason) {
  var self = this;
  if (!state || this._currentQuery !== state) return Promise.resolve();
  if (state.cancelPromise) return state.cancelPromise;
  state.cancelReason = reason;

  if (!this.backendKeyData) {
    this.destroy(reason);
    return Promise.reject(reason);
  }

  state.cancelPromise = cancel.sendCancelRequest(this.config, this.backendKeyData, { timeout: this.config.cancelTimeout }).then(function () {
    if (self._currentQuery !== state) return;
    state.cancelGraceTimer = setTimeout(function () {
      if (self._currentQuery === state) self.destroy(reason);
    }, self.cancelGraceTimeout);
    if (state.cancelGraceTimer.unref) state.cancelGraceTimer.unref();
  }, function (error) {
    if (reason && reason.cause === undefined) reason.cause = error;
    self.destroy(reason || error);
    throw error;
  });
  return state.cancelPromise;
};

Connection.prototype.cancel = function cancelCurrent(options) {
  options = options || {};
  if (!this._currentQuery) return Promise.reject(new Error('PostgreSQL connection has no active operation to cancel'));
  var reason = options.reason instanceof Error ? options.reason : cancellationError('PostgreSQL operation cancelled', 'NUBLOX_POSTGRESQL_CANCELLED');
  return this._requestOperationCancel(this._currentQuery, reason);
};

Connection.prototype._startOperation = function _startOperation(state, messages, options) {
  options = options || {};
  if (!this.connected || !this.socket || this.ended) return Promise.reject(new Error('PostgreSQL connection is not ready'));
  if (this._currentQuery) return Promise.reject(new Error('PostgreSQL connection already has an active operation'));
  if (options.timeout !== undefined && (!Number.isFinite(options.timeout) || options.timeout <= 0)) return Promise.reject(new RangeError('PostgreSQL operation timeout must be a positive number'));
  if (options.signal && options.signal.aborted) return Promise.reject(options.signal.reason || cancellationError('PostgreSQL operation aborted', 'NUBLOX_POSTGRESQL_ABORTED'));

  var self = this;
  state.promise = new Promise(function (resolve, reject) { state.resolve = resolve; state.reject = reject; });
  this._currentQuery = state;

  var timer = null;
  var abortHandler = null;
  if (options.timeout !== undefined) {
    timer = setTimeout(function () {
      self._requestOperationCancel(state, cancellationError('PostgreSQL operation timed out', 'NUBLOX_POSTGRESQL_TIMEOUT')).catch(function () {});
    }, options.timeout);
    if (timer.unref) timer.unref();
  }
  if (options.signal) {
    abortHandler = function () {
      var reason = options.signal.reason instanceof Error ? options.signal.reason : cancellationError('PostgreSQL operation aborted', 'NUBLOX_POSTGRESQL_ABORTED');
      self._requestOperationCancel(state, reason).catch(function () {});
    };
    options.signal.addEventListener('abort', abortHandler, { once: true });
  }
  state.cleanup = function () {
    if (timer) clearTimeout(timer);
    if (state.cancelGraceTimer) clearTimeout(state.cancelGraceTimer);
    if (abortHandler) options.signal.removeEventListener('abort', abortHandler);
  };

  try { this.socket.write(Buffer.concat(messages)); }
  catch (error) {
    this._currentQuery = null;
    state.cleanup();
    return Promise.reject(error);
  }
  return state.promise;
};

Connection.prototype._finishOperation = function _finishOperation(state) {
  var self = this;
  if (state && state.cancelReason) {
    if (state.error && state.cancelReason.cause === undefined) state.cancelReason.cause = state.error;
    state.error = state.cancelReason;
  }

  // CancelRequest identifies a backend session, not an individual operation.
  // Keep this operation occupying the connection until the auxiliary cancel
  // dispatch settles so a late packet cannot target a subsequent query.
  if (state && state.cancelPromise) {
    if (state.finishPending) return;
    state.finishPending = true;
    state.cancelPromise.then(function () {
      state.finishPending = false;
      if (self._currentQuery === state) base.Connection.prototype._finishOperation.call(self, state);
    }, function () {
      state.finishPending = false;
      if (self._currentQuery === state && !self.ended) self.destroy(state.cancelReason || new Error('PostgreSQL cancellation failed'));
    });
    return;
  }

  return base.Connection.prototype._finishOperation.call(this, state);
};

exports.Connection = Connection;
exports.PreparedStatement = base.PreparedStatement;
exports.PostgreSqlError = base.PostgreSqlError;
exports.PostgreSqlCancellationError = PostgreSqlCancellationError;
exports.cancellationError = cancellationError;
