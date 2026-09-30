'use strict';

var publicError = require('./PublicError');

var STATES = Object.freeze({
  IDLE: 'idle',
  OPENING: 'opening',
  OPEN: 'open',
  CLOSING: 'closing',
  CLOSED: 'closed'
});

function inferState(client) {
  var target = client && client._target;
  if (target && (target.ended === true || target._ended === true)) return STATES.CLOSED;
  if (target && target.connected === true) return STATES.OPEN;
  return STATES.IDLE;
}

function ensureState(client) {
  if (!Object.prototype.hasOwnProperty.call(client, '_lifecycleState')) {
    Object.defineProperty(client, '_lifecycleState', { value: inferState(client), writable: true, configurable: false, enumerable: false });
    Object.defineProperty(client, '_lifecycleOpenPromise', { value: null, writable: true, configurable: false, enumerable: false });
    Object.defineProperty(client, '_lifecycleClosePromise', { value: null, writable: true, configurable: false, enumerable: false });
  }
  return client._lifecycleState;
}

function lifecycleError(action, state, dialect) {
  return publicError.lifecycleError(action, state, dialect);
}

function install(clientApi) {
  if (!clientApi || !clientApi.Client) throw new TypeError('LifecycleIntegration requires the NuBloxSQL Client API');
  var Client = clientApi.Client;
  var prototype = Client.prototype;
  if (prototype.__nubloxLifecycleInstalled) return;

  var originalEnsureConnected = prototype._ensureConnected;
  var originalClose = prototype.close;

  Object.defineProperty(prototype, '__nubloxLifecycleInstalled', { value: true, configurable: false, enumerable: false, writable: false });
  Object.defineProperty(prototype, 'lifecycleState', { enumerable: true, configurable: false, get: function () { return ensureState(this); } });
  Object.defineProperty(prototype, 'isOpen', { enumerable: true, configurable: false, get: function () { return ensureState(this) === STATES.OPEN; } });
  Object.defineProperty(prototype, 'isClosed', { enumerable: true, configurable: false, get: function () { return ensureState(this) === STATES.CLOSED; } });

  prototype._ensureConnected = function lifecycleEnsureConnected(target) {
    target = target || this._target;
    if (target !== this._target) return originalEnsureConnected.call(this, target);

    var state = ensureState(this);
    if (state === STATES.CLOSED || state === STATES.CLOSING) {
      return Promise.reject(lifecycleError('open or execute operations', state, this.dialect));
    }

    if (target && (target.ended === true || target._ended === true)) {
      this._lifecycleState = STATES.CLOSED;
      return Promise.reject(lifecycleError('open or execute operations', STATES.CLOSED, this.dialect));
    }

    if (this._lifecycleOpenPromise) return this._lifecycleOpenPromise;

    var self = this;
    this._lifecycleState = STATES.OPENING;
    var opening = Promise.resolve()
      .then(function () { return originalEnsureConnected.call(self, target); })
      .then(function (resolvedTarget) {
        if (self._lifecycleState !== STATES.CLOSING && self._lifecycleState !== STATES.CLOSED) self._lifecycleState = STATES.OPEN;
        return resolvedTarget;
      }, function (error) {
        if (self._lifecycleState === STATES.OPENING) self._lifecycleState = STATES.IDLE;
        throw error;
      });

    this._lifecycleOpenPromise = opening;
    opening.then(function () { if (self._lifecycleOpenPromise === opening) self._lifecycleOpenPromise = null; }, function () { if (self._lifecycleOpenPromise === opening) self._lifecycleOpenPromise = null; });
    return opening;
  };

  prototype.connect = function connect() {
    var self = this;
    return this._ensureConnected().then(function () { return self; });
  };

  prototype.open = function open() { return this.connect(); };

  prototype.close = function close() {
    var state = ensureState(this);
    if (state === STATES.CLOSED) return Promise.resolve();
    if (this._lifecycleClosePromise) return this._lifecycleClosePromise;

    var self = this;
    var opening = this._lifecycleOpenPromise;
    this._lifecycleState = STATES.CLOSING;

    var closing = Promise.resolve()
      .then(async function () {
        if (opening) {
          try { await opening; } catch (openError) { /* cleanup still runs */ }
        }
        await originalClose.call(self);
      })
      .then(function () { self._lifecycleState = STATES.CLOSED; }, function (error) {
        self._lifecycleState = STATES.CLOSED;
        throw error;
      });

    this._lifecycleClosePromise = closing;
    return closing;
  };

  prototype.end = function end() { return this.close(); };
}

exports.STATES = STATES;
exports.install = install;
exports.lifecycleError = lifecycleError;
