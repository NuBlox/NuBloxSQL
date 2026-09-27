var Util           = require('util');
var EventEmitter   = require('events').EventEmitter;
var Packets        = require('../packets');
var ErrorConstants = require('../constants/errors');
var Timer          = require('../Timer');

var listenerCount = EventEmitter.listenerCount
  || function(emitter, type){ return emitter.listeners(type).length; };

var LONG_STACK_DELIMITER = '\n    --------------------\n';

module.exports = Sequence;
Util.inherits(Sequence, EventEmitter);
function Sequence(options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  EventEmitter.call(this);

  options = options || {};

  this._callback = callback;
  this._callSite = null;
  this._ended    = false;
  this._timeout  = options.timeout;
  this._timer    = new Timer(this);
  this._operationTimeout = normalizeOperationTimeout(options.operationTimeout);
  this._operationDeadlineAt = normalizeOperationDeadlineAt(
    options.operationDeadlineAt,
    this._operationTimeout
  );
  this._operationTimer = null;
  this._abortSignals = normalizeAbortSignals(options.signal, options.signals);
  this._signalManagedByProtocol = this._abortSignals.length > 0;
  this._started = false;
}

Sequence.determinePacket = function(byte) {
  switch (byte) {
    case 0x00: return Packets.OkPacket;
    case 0xfe: return Packets.EofPacket;
    case 0xff: return Packets.ErrorPacket;
    default:   return undefined;
  }
};

Sequence.prototype.hasErrorHandler = function() {
  return Boolean(this._callback) || listenerCount(this, 'error') > 1;
};

Sequence.prototype._packetToError = function(packet) {
  var code = ErrorConstants[packet.errno] || 'UNKNOWN_CODE_PLEASE_REPORT';
  var err  = new Error(code + ': ' + packet.message);
  err.code = code;
  err.errno = packet.errno;

  err.sqlMessage = packet.message;
  err.sqlState   = packet.sqlState;

  return err;
};

Sequence.prototype.end = function(err) {
  if (this._ended) {
    return;
  }

  this._ended = true;
  this._stopOperationDeadline();

  if (err) {
    this._addLongStackTrace(err);
  }

  this._callSite = null;

  try {
    if (err) {
      this.emit('error', err);
    }
  } finally {
    try {
      if (this._callback) {
        this._callback.apply(this, arguments);
      }
    } finally {
      this.emit('end');
    }
  }
};

Sequence.prototype['OkPacket'] = function(packet) {
  this.end(null, packet);
};

Sequence.prototype['ErrorPacket'] = function(packet) {
  this.end(this._packetToError(packet));
};

Sequence.prototype.start = function() {};

Sequence.prototype._addLongStackTrace = function _addLongStackTrace(err) {
  var callSiteStack = this._callSite && this._callSite.stack;

  if (!callSiteStack || typeof callSiteStack !== 'string') {
    return;
  }

  if (err.stack.indexOf(LONG_STACK_DELIMITER) !== -1) {
    return;
  }

  var index = callSiteStack.indexOf('\n');

  if (index !== -1) {
    err.stack += LONG_STACK_DELIMITER + callSiteStack.substr(index + 1);
  }
};

Sequence.prototype._onTimeout = function _onTimeout() {
  this.emit('timeout');
};

Sequence.prototype._startOperationDeadline = function _startOperationDeadline() {
  if (!this._operationDeadlineAt || this._operationTimer || this._ended) {
    return;
  }

  var self = this;
  var remaining = this._operationDeadlineAt - Date.now();

  if (remaining <= 0) {
    process.nextTick(function () {
      if (!self._ended) {
        self.emit('operation-timeout');
      }
    });
    return;
  }

  this._operationTimer = setTimeout(function () {
    self._operationTimer = null;
    if (!self._ended) {
      self.emit('operation-timeout');
    }
  }, remaining);
};

Sequence.prototype._stopOperationDeadline = function _stopOperationDeadline() {
  if (this._operationTimer) {
    clearTimeout(this._operationTimer);
    this._operationTimer = null;
  }
};

function normalizeOperationTimeout(value) {
  if (value === undefined || value === null) {
    return 0;
  }

  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('operationTimeout must be a non-negative safe integer');
  }

  return value;
}

function normalizeOperationDeadlineAt(value, operationTimeout) {
  if (value === undefined || value === null) {
    return operationTimeout > 0 ? Date.now() + operationTimeout : 0;
  }

  if (value === 0 && operationTimeout === 0) {
    return 0;
  }

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError('operationDeadlineAt must be a positive safe integer or 0 when disabled');
  }

  return value;
}

function normalizeAbortSignals(signal, signals) {
  var values = [];

  if (signal !== undefined && signal !== null) {
    values.push(signal);
  }

  if (signals !== undefined && signals !== null) {
    if (!Array.isArray(signals)) {
      throw new TypeError('signals must be an array of AbortSignal-like objects');
    }

    values = values.concat(signals);
  }

  var normalized = [];
  for (var i = 0; i < values.length; i++) {
    var value = values[i];

    if (!value || typeof value.aborted !== 'boolean' ||
        typeof value.addEventListener !== 'function' ||
        typeof value.removeEventListener !== 'function') {
      throw new TypeError('signal must be an AbortSignal-like object');
    }

    if (normalized.indexOf(value) === -1) {
      normalized.push(value);
    }
  }

  return normalized;
}
