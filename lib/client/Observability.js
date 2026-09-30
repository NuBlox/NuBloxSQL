'use strict';

var EVENT_SCHEMA_VERSION = 1;
var EVENT_TYPES = Object.freeze({
  QUERY: 'query',
  EXECUTE: 'execute',
  PREPARE: 'prepare',
  PREPARED: 'prepared',
  TRANSACTION: 'transaction',
  TRANSACTION_RETRY: 'transaction_retry',
  STREAM: 'stream',
  CONNECTION: 'connection',
  ERROR: 'error'
});
var clientSequence = 0;

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
  this.operationSequence = 0;
  this.clientId = 'client-' + String(++clientSequence);
}

Observer.prototype.enabled = function enabled() {
  return !!this.config;
};

Observer.prototype._dispatch = function _dispatch(handler, event) {
  try { if (typeof handler === 'function') handler(event); } catch (_) {}
};

Observer.prototype.emit = function emit(type, details) {
  if (!this.config) return null;
  var id = ++this.sequence;
  var event = Object.freeze(Object.assign({
    schemaVersion: EVENT_SCHEMA_VERSION,
    id: id,
    eventId: id,
    clientId: this.clientId,
    type: type,
    dialect: this.client.dialect,
    timestamp: Date.now()
  }, details || {}));
  this._dispatch(this.config.onEvent, event);
  this._dispatch(this.config['on' + type.split('_').map(function (part) { return part.charAt(0).toUpperCase() + part.slice(1); }).join('')], event);
  return event;
};

Observer.prototype.start = function start(type, details) {
  if (!this.config) return function () {};
  var started = monotonicMs();
  var operationId = this.clientId + ':op-' + String(++this.operationSequence);
  var base = Object.assign({ operationId: operationId }, details || {});
  this.emit(type, Object.assign({ phase: 'start' }, base));
  var self = this;
  var finished = false;
  return function finish(extra) {
    if (finished) return;
    finished = true;
    var durationMs = Math.max(0, monotonicMs() - started);
    var event = Object.assign({ phase: 'finish', durationMs: durationMs }, base, extra || {});
    var threshold = Number(self.config.slowOperationThresholdMs);
    if (!Number.isFinite(threshold)) {
      var queryThreshold = Number(self.config.slowQueryThresholdMs);
      if ((type === EVENT_TYPES.QUERY || type === EVENT_TYPES.EXECUTE || type === EVENT_TYPES.PREPARED || type === EVENT_TYPES.STREAM) && Number.isFinite(queryThreshold)) threshold = queryThreshold;
    }
    if (Number.isFinite(threshold) && threshold >= 0) event.slow = durationMs >= threshold;
    self.emit(type, event);
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

function safeSqlText(client, statement) {
  if (typeof statement === 'string') return statement;
  try { return client.compile(statement).text; } catch (_) { return null; }
}

function statementDetails(receiver, args) {
  var client = receiver.client || receiver;
  var telemetry = client && client.config && client.config.telemetry;
  var details = {};
  if (telemetry && telemetry.includeSql === true && args && args.length) {
    var text = safeSqlText(client, args[0]);
    if (text !== null) details.sql = text;
  }
  if (receiver.transactionAttempt !== undefined) details.transactionAttempt = receiver.transactionAttempt;
  var pool = poolDetails(client);
  if (pool) details.pool = pool;
  return details;
}

function failureDetails(error) {
  return {
    success: false,
    errorCategory: error && error.category || null,
    errorCode: error && error.code || null,
    errorName: error && error.name || null,
    retryable: !!(error && error.retryable)
  };
}

function observerFor(receiver) {
  var client = receiver.client || receiver;
  if (!client || !client.config || !client.config.telemetry) return null;
  if (!client._observer) client._observer = new Observer(client);
  return client._observer;
}

function emit(receiver, type, details) {
  var observer = observerFor(receiver);
  return observer ? observer.emit(type, details) : null;
}

function wrap(prototype, method, type) {
  if (!prototype || typeof prototype[method] !== 'function') return;
  var original = prototype[method];
  if (original._nubloxObserved) return;

  function observed() {
    var args = Array.prototype.slice.call(arguments);
    var observer = observerFor(this);
    if (!observer || !observer.enabled()) return original.apply(this, args);
    var details = Object.assign({ operation: method }, statementDetails(this, args));
    var finish = observer.start(type, details);
    var result;
    try { result = original.apply(this, args); }
    catch (error) {
      finish(failureDetails(error));
      observer.emit(EVENT_TYPES.ERROR, Object.assign({ operation: method }, failureDetails(error)));
      throw error;
    }
    if (result && typeof result.then === 'function') {
      return result.then(function (value) {
        finish(Object.assign({ success: true }, resultDetails(value)));
        return value;
      }, function (error) {
        finish(failureDetails(error));
        observer.emit(EVENT_TYPES.ERROR, Object.assign({ operation: method }, failureDetails(error)));
        throw error;
      });
    }
    finish(Object.assign({ success: true }, resultDetails(result)));
    return result;
  }

  Object.defineProperty(observed, '_nubloxObserved', { value: true });
  prototype[method] = observed;
}

function instrumentStreams(streamApi) {
  var Stream = streamApi && streamApi.ClientRowStream;
  if (!Stream || Stream.prototype._nubloxTelemetryInstalled) return;
  var initialize = Stream.prototype._initialize;
  var next = Stream.prototype.next;
  var cleanup = Stream.prototype._cleanup;

  Stream.prototype._initialize = async function observedStreamInitialize() {
    var observer = observerFor(this);
    if (observer && !this._telemetryFinish) {
      this._telemetryRows = 0;
      this._telemetryFinish = observer.start(EVENT_TYPES.STREAM, Object.assign({ operation: 'stream' }, statementDetails(this.client, [this.compiled.text])));
    }
    try { return await initialize.apply(this, arguments); }
    catch (error) {
      if (this._telemetryFinish) this._telemetryFinish(failureDetails(error));
      if (observer) observer.emit(EVENT_TYPES.ERROR, Object.assign({ operation: 'stream' }, failureDetails(error)));
      throw error;
    }
  };

  Stream.prototype.next = async function observedStreamNext() {
    var item = await next.apply(this, arguments);
    if (item && !item.done) this._telemetryRows = (this._telemetryRows || 0) + 1;
    return item;
  };

  Stream.prototype._cleanup = async function observedStreamCleanup(success) {
    try {
      var result = await cleanup.apply(this, arguments);
      if (this._telemetryFinish) this._telemetryFinish({ success: success !== false, rowCount: this._telemetryRows || 0 });
      return result;
    } catch (error) {
      if (this._telemetryFinish) this._telemetryFinish(failureDetails(error));
      throw error;
    }
  };
  Object.defineProperty(Stream.prototype, '_nubloxTelemetryInstalled', { value: true });
}

function install(clientApi, streamApi) {
  if (!clientApi || !clientApi.Client) return;
  ['query', 'execute', 'prepare', 'transaction', 'connect', 'open', 'close', 'end'].forEach(function (method) {
    var type = (method === 'connect' || method === 'open' || method === 'close' || method === 'end') ? EVENT_TYPES.CONNECTION : method;
    wrap(clientApi.Client.prototype, method, type);
  });
  ['query', 'execute', 'close'].forEach(function (method) {
    wrap(clientApi.PreparedClientStatement && clientApi.PreparedClientStatement.prototype, method, method === 'close' ? EVENT_TYPES.PREPARE : EVENT_TYPES.PREPARED);
  });
  instrumentStreams(streamApi);
}

exports.EVENT_SCHEMA_VERSION = EVENT_SCHEMA_VERSION;
exports.EVENT_TYPES = EVENT_TYPES;
exports.Observer = Observer;
exports.install = install;
exports.emit = emit;
exports.observerFor = observerFor;
exports.poolDetails = poolDetails;
exports.monotonicMs = monotonicMs;
