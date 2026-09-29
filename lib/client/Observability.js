'use strict';

function monotonicMs() {
  return Number(process.hrtime.bigint()) / 1000000;
}

function Observer(client) {
  var telemetry = client && client.config && client.config.telemetry;
  if (telemetry !== undefined && (telemetry === null || typeof telemetry !== 'object' || Array.isArray(telemetry))) {
    throw new TypeError('NuBloxSQL telemetry must be an options object');
  }
  this.client = client;
  this.config = telemetry || null;
  this.sequence = 0;
}

Observer.prototype.enabled = function enabled() {
  return !!this.config;
};

Observer.prototype._dispatch = function _dispatch(handler, event) {
  try { if (typeof handler === 'function') handler(event); } catch (_) {}
};

Observer.prototype.emit = function emit(type, details) {
  if (!this.config) return null;
  var event = Object.freeze(Object.assign({
    id: ++this.sequence,
    type: type,
    dialect: this.client.dialect,
    timestamp: Date.now()
  }, details || {}));
  this._dispatch(this.config.onEvent, event);
  this._dispatch(this.config['on' + type.charAt(0).toUpperCase() + type.slice(1)], event);
  return event;
};

Observer.prototype.start = function start(type, details) {
  if (!this.config) return function () {};
  var started = monotonicMs();
  var base = Object.assign({}, details || {});
  this.emit(type, Object.assign({ phase: 'start' }, base));
  var self = this;
  return function finish(extra) {
    var durationMs = Math.max(0, monotonicMs() - started);
    var finished = Object.assign({ phase: 'finish', durationMs: durationMs }, base, extra || {});
    var threshold = Number(self.config.slowQueryThresholdMs);
    if ((type === 'query' || type === 'execute' || type === 'prepared' || type === 'stream') && Number.isFinite(threshold) && threshold >= 0) {
      finished.slow = durationMs >= threshold;
    }
    self.emit(type, finished);
  };
};

function resultDetails(value) {
  var details = {};
  if (!value || typeof value !== 'object') return details;
  if (Array.isArray(value)) details.rowCount = value.length;
  else if (typeof value.rowCount === 'number') details.rowCount = value.rowCount;
  if (value.affectedRows !== undefined && value.affectedRows !== null) details.affectedRows = value.affectedRows;
  if (value.command) details.command = value.command;
  return details;
}

function poolDetails(client) {
  var pool = client && client._isPool && client._target;
  if (!pool) return null;
  var details = {};
  if (pool._all && typeof pool._all.size === 'number') details.total = pool._all.size;
  if (pool._idle && typeof pool._idle.length === 'number') details.idle = pool._idle.length;
  if (pool._borrowed && typeof pool._borrowed.size === 'number') details.borrowed = pool._borrowed.size;
  if (pool._waiters && typeof pool._waiters.length === 'number') details.waiting = pool._waiters.length;
  return Object.keys(details).length ? Object.freeze(details) : null;
}

function statementDetails(receiver, args) {
  var client = receiver.client || receiver;
  var telemetry = client && client.config && client.config.telemetry;
  var details = {};
  if (telemetry && telemetry.includeSql === true && args && args.length && typeof args[0] === 'string') details.sql = args[0];
  var pool = poolDetails(client);
  if (pool) details.pool = pool;
  return details;
}

function failureDetails(error) {
  return {
    success: false,
    errorCategory: error && error.category || null,
    errorCode: error && error.code || null,
    retryable: !!(error && error.retryable)
  };
}

function wrap(prototype, method, type) {
  if (!prototype || typeof prototype[method] !== 'function') return;
  var original = prototype[method];
  if (original._nubloxObserved) return;

  function observed() {
    var args = Array.prototype.slice.call(arguments);
    var observer = this._observer || (this.client && this.client._observer);
    if (!observer || !observer.enabled()) return original.apply(this, args);
    var details = Object.assign({ operation: method }, statementDetails(this, args));
    var finish = observer.start(type, details);
    var result;
    try { result = original.apply(this, args); }
    catch (error) {
      finish(failureDetails(error));
      observer.emit('error', Object.assign({ operation: method }, failureDetails(error)));
      throw error;
    }
    if (result && typeof result.then === 'function') {
      return result.then(function (value) {
        finish(Object.assign({ success: true }, resultDetails(value)));
        return value;
      }, function (error) {
        finish(failureDetails(error));
        observer.emit('error', Object.assign({ operation: method }, failureDetails(error)));
        throw error;
      });
    }
    finish(Object.assign({ success: true }, resultDetails(result)));
    return result;
  }

  Object.defineProperty(observed, '_nubloxObserved', { value: true });
  prototype[method] = observed;
}

function install(clientApi, streamApi) {
  if (!clientApi || !clientApi.Client) return;
  ['query', 'execute', 'prepare', 'transaction', 'close'].forEach(function (method) {
    wrap(clientApi.Client.prototype, method, method === 'close' ? 'connection' : method);
  });
  ['query', 'execute', 'close'].forEach(function (method) {
    wrap(clientApi.PreparedClientStatement && clientApi.PreparedClientStatement.prototype, method, method === 'close' ? 'prepare' : 'prepared');
  });
  if (streamApi && streamApi.ClientRowStream) {
    wrap(streamApi.ClientRowStream.prototype, '_initialize', 'stream');
    wrap(streamApi.ClientRowStream.prototype, 'close', 'stream');
  }
}

exports.Observer = Observer;
exports.install = install;
exports.poolDetails = poolDetails;
exports.monotonicMs = monotonicMs;
