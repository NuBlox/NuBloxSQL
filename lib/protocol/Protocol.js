var Parser               = require('./Parser');
var Sequences            = require('./sequences');
var Packets              = require('./packets');
var Stream               = require('stream').Stream;
var Util                 = require('util');
var PacketWriter         = require('./PacketWriter');
var CompressedProtocol   = require('./CompressedProtocol');
var InboundPacketLimiter = require('./InboundPacketLimiter');

var DEFAULT_MAX_INBOUND_PACKET_SIZE = 64 * 1024 * 1024;

module.exports = Protocol;
Util.inherits(Protocol, Stream);
function Protocol(options) {
  Stream.call(this);

  options = options || {};

  this.readable = true;
  this.writable = true;

  this._config                        = options.config || {};
  this._connection                    = options.connection;
  this._callback                      = null;
  this._fatalError                    = null;
  this._quitSequence                  = null;
  this._handshake                     = false;
  this._handshaked                    = false;
  this._ended                         = false;
  this._destroyed                     = false;
  this._queue                         = [];
  this._handshakeInitializationPacket = null;
  this._compression                   = new CompressedProtocol();
  this._inboundPacketLimiter          = new InboundPacketLimiter(
    this._config.maxInboundPacketSize || DEFAULT_MAX_INBOUND_PACKET_SIZE
  );

  this._parser = new Parser({
    onError  : this.handleParserError.bind(this),
    onPacket : this._parsePacket.bind(this),
    config   : this._config
  });
}

Protocol.prototype.write = function(buffer) {
  var self = this;

  try {
    this._compression.write(buffer, function (payload) {
      self._inboundPacketLimiter.write(payload);
      self._parser.write(payload);
    });
  } catch (err) {
    if (!isCompressionError(err) && !isResourceLimitError(err)) {
      throw err;
    }

    this._delegateError(err);
  }

  return true;
};

Protocol.prototype.handshake = function handshake(options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  options = options || {};
  options.config = this._config;

  var sequence = this._enqueue(new Sequences.Handshake(options, callback));

  this._handshake = true;

  return sequence;
};

Protocol.prototype.query = function query(options, callback) {
  return this._enqueue(new Sequences.Query(options, callback));
};

Protocol.prototype.changeUser = function changeUser(options, callback) {
  return this._enqueue(new Sequences.ChangeUser(options, callback));
};

Protocol.prototype.ping = function ping(options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  return this._enqueue(new Sequences.Ping(options, callback));
};

Protocol.prototype.stats = function stats(options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  return this._enqueue(new Sequences.Statistics(options, callback));
};

Protocol.prototype.quit = function quit(options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  var self     = this;
  var sequence = this._enqueue(new Sequences.Quit(options, callback));

  sequence.on('end', function () {
    self.end();
  });

  return this._quitSequence = sequence;
};

Protocol.prototype.end = function() {
  if (this._ended) {
    return;
  }
  this._ended = true;

  if (this._quitSequence && (this._quitSequence._ended || this._queue[0] === this._quitSequence)) {
    this._quitSequence.end();
    this.emit('end');
    return;
  }

  var err = new Error('Connection lost: The server closed the connection.');
  err.fatal = true;
  err.code = 'PROTOCOL_CONNECTION_LOST';

  this._delegateError(err);
};

Protocol.prototype.pause = function() {
  this._parser.pause();
  var seq = this._queue[0];
  if (seq && seq.emit) {
    seq.emit('pause');
  }
};

Protocol.prototype.resume = function() {
  this._parser.resume();
  var seq = this._queue[0];
  if (seq && seq.emit) {
    seq.emit('resume');
  }
};

Protocol.prototype._enqueue = function(sequence) {
  if (!this._validateEnqueue(sequence)) {
    return sequence;
  }

  if (this._config.trace) {
    sequence._callSite = sequence._callSite || new Error();
  }

  this._queue.push(sequence);
  this.emit('enqueue', sequence);

  var self = this;
  sequence
    .on('error', function(err) {
      self._delegateError(err, sequence);
    })
    .on('packet', function(packet) {
      sequence._timer.active();
      self._emitPacket(packet);
    })
    .on('timeout', function() {
      var err = new Error(sequence.constructor.name + ' inactivity timeout');

      err.code    = 'PROTOCOL_SEQUENCE_TIMEOUT';
      err.fatal   = true;
      err.timeout = sequence._timeout;

      self._delegateError(err, sequence);
    })
    .on('operation-timeout', function() {
      var err = new Error(sequence.constructor.name + ' operation timeout');

      err.code             = 'PROTOCOL_OPERATION_TIMEOUT';
      err.fatal            = true;
      err.operationTimeout = sequence._operationTimeout;

      self._delegateError(err, sequence);
    });

  if (sequence.constructor === Sequences.Handshake) {
    sequence.on('start-tls', function () {
      sequence._timer.active();
      self._connection._startTLS(function(err) {
        if (err) {
          err.code  = 'HANDSHAKE_SSL_ERROR';
          err.fatal = true;
          sequence.end(err);
          return;
        }

        sequence._timer.active();
        sequence._tlsUpgradeCompleteHandler();
      });
    });

    sequence.on('compression', function (algorithm) {
      self._compression.activate(algorithm);
    });

    sequence.on('end', function () {
      self._handshaked = true;

      if (!self._fatalError) {
        self.emit('handshake', self._handshakeInitializationPacket);
      }
    });
  }

  sequence.on('end', function () {
    self._dequeue(sequence);
  });

  if (this._queue.length === 1) {
    this._resetPacketNumber();
    this._startSequence(sequence);
  }

  return sequence;
};

Protocol.prototype._validateEnqueue = function _validateEnqueue(sequence) {
  var err;
  var prefix = 'Cannot enqueue ' + sequence.constructor.name;

  if (this._fatalError) {
    err      = new Error(prefix + ' after fatal error.');
    err.code = 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR';
  } else if (this._quitSequence) {
    err      = new Error(prefix + ' after invoking quit.');
    err.code = 'PROTOCOL_ENQUEUE_AFTER_QUIT';
  } else if (this._destroyed) {
    err      = new Error(prefix + ' after being destroyed.');
    err.code = 'PROTOCOL_ENQUEUE_AFTER_DESTROY';
  } else if ((this._handshake || this._handshaked) && sequence.constructor === Sequences.Handshake) {
    err      = new Error(prefix + ' after already enqueuing a Handshake.');
    err.code = 'PROTOCOL_ENQUEUE_HANDSHAKE_TWICE';
  } else {
    return true;
  }

  var self  = this;
  err.fatal = false;

  sequence.on('error', function (err) {
    self._delegateError(err, sequence);
  });

  process.nextTick(function () {
    sequence.end(err);
  });

  return false;
};

Protocol.prototype._parsePacket = function() {
  var sequence = this._queue[0];

  if (!sequence) {
    var err   = new Error('Received packet with no active sequence.');
    err.code  = 'PROTOCOL_STRAY_PACKET';
    err.fatal = true;

    this._delegateError(err);
    return;
  }

  var Packet     = this._determinePacket(sequence);
  var packet     = new Packet({protocol41: this._config.protocol41});
  var packetName = Packet.name;

  if (Packet === Packets.RowDataPacket) {
    sequence.RowDataPacket(packet, this._parser, this._connection);

    if (this._config.debug) {
      this._debugPacket(true, packet);
    }

    return;
  }

  if (this._config.debug) {
    this._parsePacketDebug(packet);
  } else {
    packet.parse(this._parser);
  }

  if (Packet === Packets.HandshakeInitializationPacket) {
    this._handshakeInitializationPacket = packet;
    this.emit('initialize', packet);
  }

  sequence._timer.active();

  if (!sequence[packetName]) {
    var err   = new Error('Received packet in the wrong sequence.');
    err.code  = 'PROTOCOL_INCORRECT_PACKET_SEQUENCE';
    err.fatal = true;

    this._delegateError(err);
    return;
  }

  sequence[packetName](packet);
};

Protocol.prototype._parsePacketDebug = function _parsePacketDebug(packet) {
  try {
    packet.parse(this._parser);
  } finally {
    this._debugPacket(true, packet);
  }
};

Protocol.prototype._emitPacket = function(packet) {
  var packetWriter = new PacketWriter();
  packet.write(packetWriter);
  var buffer = packetWriter.toBuffer(this._parser);

  try {
    this.emit('data', this._compression.encode(buffer));
  } catch (err) {
    this._delegateError(err);
    return;
  }

  if (this._config.debug) {
    this._debugPacket(false, packet);
  }
};

Protocol.prototype._determinePacket = function(sequence) {
  var firstByte = this._parser.peak();

  if (sequence.determinePacket) {
    var Packet = sequence.determinePacket(firstByte, this._parser);
    if (Packet) {
      return Packet;
    }
  }

  switch (firstByte) {
    case 0x00: return Packets.OkPacket;
    case 0xfe: return Packets.EofPacket;
    case 0xff: return Packets.ErrorPacket;
  }

  throw new Error('Could not determine packet, firstByte = ' + firstByte);
};

Protocol.prototype._dequeue = function(sequence) {
  sequence._timer.stop();

  if (this._fatalError) {
    return;
  }

  this._queue.shift();

  var sequence = this._queue[0];
  if (!sequence) {
    this.emit('drain');
    return;
  }

  this._resetPacketNumber();

  this._startSequence(sequence);
};

Protocol.prototype._startSequence = function(sequence) {
  sequence._startOperationDeadline();

  if (sequence._timeout > 0 && isFinite(sequence._timeout)) {
    sequence._timer.start(sequence._timeout);
  }

  if (sequence.constructor === Sequences.ChangeUser) {
    sequence.start(this._handshakeInitializationPacket);
  } else {
    sequence.start();
  }
};

Protocol.prototype._resetPacketNumber = function _resetPacketNumber() {
  this._parser.resetPacketNumber();
  this._compression.resetPacketNumber();
  this._inboundPacketLimiter.reset();
};

Protocol.prototype.handleNetworkError = function(err) {
  err.fatal = true;

  var sequence = this._queue[0];
  if (sequence) {
    sequence.end(err);
  } else {
    this._delegateError(err);
  }
};

Protocol.prototype.handleParserError = function handleParserError(err) {
  var sequence = this._queue[0];
  if (sequence) {
    sequence.end(err);
  } else {
    this._delegateError(err);
  }
};

Protocol.prototype._delegateError = function(err, sequence) {
  if (this._fatalError) {
    return;
  }

  if (err.fatal) {
    this._fatalError = err;
  }

  if (this._shouldErrorBubbleUp(err, sequence)) {
    this.emit('unhandledError', err);
  } else if (err.fatal) {
    var queue = this._queue;
    process.nextTick(function () {
      queue.forEach(function (sequence) {
        sequence.end(err);
      });
      queue.length = 0;
    });
  }

  if (err.fatal) {
    this.emit('end', err);
  }
};

Protocol.prototype._shouldErrorBubbleUp = function(err, sequence) {
  if (sequence) {
    if (sequence.hasErrorHandler()) {
      return false;
    } else if (!err.fatal) {
      return true;
    }
  }

  return (err.fatal && !this._hasPendingErrorHandlers());
};

Protocol.prototype._hasPendingErrorHandlers = function() {
  return this._queue.some(function(sequence) {
    return sequence.hasErrorHandler();
  });
};

Protocol.prototype.destroy = function() {
  this._destroyed = true;
  this._parser.pause();

  if (this._connection.state !== 'disconnected') {
    if (!this._ended) {
      this.end();
    }
  }
};

Protocol.prototype._debugPacket = function(incoming, packet) {
  var connection = this._connection;
  var direction  = incoming
    ? '<--'
    : '-->';
  var packetName = packet.constructor.name;
  var threadId   = connection && connection.threadId !== null
    ? ' (' + connection.threadId + ')'
    : '';

  if (Array.isArray(this._config.debug) && this._config.debug.indexOf(packetName) === -1) {
    return;
  }

  var packetPayload = Util.inspect(packet).replace(/^[^{]+/, '');

  console.log('%s%s %s %s\n', direction, threadId, packetName, packetPayload);
};

function isCompressionError(err) {
  return Boolean(err && (
    err.code === 'PROTOCOL_COMPRESSED_PACKETS_OUT_OF_ORDER' ||
    err.code === 'PROTOCOL_COMPRESSION_INFLATE_ERROR' ||
    err.code === 'PROTOCOL_COMPRESSION_ZSTD_DECOMPRESS_ERROR' ||
    err.code === 'PROTOCOL_COMPRESSION_LENGTH_MISMATCH' ||
    err.code === 'PROTOCOL_COMPRESSION_UNSUPPORTED_ALGORITHM'
  ));
}

function isResourceLimitError(err) {
  return Boolean(err && (
    err.code === 'PROTOCOL_INBOUND_PACKET_TOO_LARGE' ||
    err.code === 'PROTOCOL_RESULTSET_COLUMNS_TOO_LARGE' ||
    err.code === 'PROTOCOL_RESULTSET_METADATA_TOO_LARGE' ||
    err.code === 'PROTOCOL_RESULTSET_FIELD_TOO_LARGE' ||
    err.code === 'PROTOCOL_RESULTSET_ROW_TOO_LARGE' ||
    err.code === 'PROTOCOL_RESULTSET_ROWS_TOO_LARGE' ||
    err.code === 'PROTOCOL_RESULTSET_SIZE_TOO_LARGE'
  ));
}
