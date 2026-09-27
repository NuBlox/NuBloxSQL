var ClientConstants = require('../constants/client');
var Diagnostics     = require('diagnostics_channel');
var fs              = require('fs');
var Packets         = require('../packets');
var ResultSet       = require('../ResultSet');
var ResourceLimits  = require('../ResultSetResourceLimits');
var Sequence        = require('./Sequence');
var ServerStatus    = require('../constants/server_status');
var Readable        = require('stream').Readable;
var Util            = require('util');

var StreamBackpressureChannel = Diagnostics.channel('nublox.mysql.stream.backpressure');

module.exports = Query;
Util.inherits(Query, Sequence);
function Query(options, callback) {
  Sequence.call(this, options, callback);

  this.sql = options.sql;
  this.values = options.values;
  this.typeCast = (options.typeCast === undefined)
    ? true
    : options.typeCast;
  this.nestTables = options.nestTables || false;

  this._resultSet = null;
  this._results   = [];
  this._fields    = [];
  this._index     = 0;
  this._loadError = null;
}

Query.prototype.start = function() {
  this.emit('packet', new Packets.ComQueryPacket(this.sql));
};

Query.prototype.determinePacket = function determinePacket(byte, parser) {
  var resultSet = this._resultSet;

  if (!resultSet) {
    switch (byte) {
      case 0x00: return Packets.OkPacket;
      case 0xfb: return Packets.LocalInfileRequestPacket;
      case 0xff: return Packets.ErrorPacket;
      default:   return Packets.ResultSetHeaderPacket;
    }
  }

  if (resultSet.eofPackets.length === 0) {
    if (resultSet.fieldPackets.length < resultSet.resultSetHeaderPacket.fieldCount) {
      ResourceLimits.noteMetadataPacket(this._connection, resultSet, parser.packetLength());
      return Packets.FieldPacket;
    }

    return Packets.EofPacket;
  }

  if (byte === 0xff) {
    return Packets.ErrorPacket;
  }

  if (byte === 0xfe && parser.packetLength() < 9) {
    return Packets.EofPacket;
  }

  ResourceLimits.noteRowPacket(
    this._connection,
    resultSet,
    parser.packetLength(),
    Boolean(this._callback)
  );
  return Packets.RowDataPacket;
};

Query.prototype['OkPacket'] = function(packet) {
  try {
    if (!this._callback) {
      this.emit('result', packet, this._index);
    } else {
      this._results.push(packet);
      this._fields.push(undefined);
    }
  } finally {
    this._index++;
    this._resultSet = null;
    this._handleFinalResultPacket(packet);
  }
};

Query.prototype['ErrorPacket'] = function(packet) {
  var err = this._packetToError(packet);

  var results = (this._results.length > 0)
    ? this._results
    : undefined;

  var fields = (this._fields.length > 0)
    ? this._fields
    : undefined;

  err.index = this._index;
  err.sql   = this.sql;

  this.end(err, results, fields);
};

Query.prototype['LocalInfileRequestPacket'] = function(packet) {
  if (this._connection.config.clientFlags & ClientConstants.CLIENT_LOCAL_FILES) {
    this._sendLocalDataFile(packet.filename);
  } else {
    this._loadError       = new Error('Load local files command is disabled');
    this._loadError.code  = 'LOCAL_FILES_DISABLED';
    this._loadError.fatal = false;

    this.emit('packet', new Packets.EmptyPacket());
  }
};

Query.prototype['ResultSetHeaderPacket'] = function(packet) {
  ResourceLimits.assertColumnCount(this._connection, packet.fieldCount);
  this._resultSet = new ResultSet(packet);
};

Query.prototype['FieldPacket'] = function(packet) {
  this._resultSet.fieldPackets.push(packet);
};

Query.prototype['EofPacket'] = function(packet) {
  this._resultSet.eofPackets.push(packet);

  if (this._resultSet.eofPackets.length === 1 && !this._callback) {
    this.emit('fields', this._resultSet.fieldPackets, this._index);
  }

  if (this._resultSet.eofPackets.length !== 2) {
    return;
  }

  if (this._callback) {
    this._results.push(this._resultSet.rows);
    this._fields.push(this._resultSet.fieldPackets);
  }

  this._index++;
  this._resultSet = null;
  this._handleFinalResultPacket(packet);
};

Query.prototype._handleFinalResultPacket = function(packet) {
  if (packet.serverStatus & ServerStatus.SERVER_MORE_RESULTS_EXISTS) {
    return;
  }

  var results = (this._results.length > 1)
    ? this._results
    : this._results[0];

  var fields = (this._fields.length > 1)
    ? this._fields
    : this._fields[0];

  this.end(this._loadError, results, fields);
};

Query.prototype['RowDataPacket'] = function(packet, parser, connection) {
  packet.parse(parser, this._resultSet.fieldPackets, this.typeCast, this.nestTables, connection);

  if (this._callback) {
    this._resultSet.rows.push(packet);
  } else {
    this.emit('result', packet, this._index);
  }
};

Query.prototype._sendLocalDataFile = function(path) {
  var self = this;
  var localStream = fs.createReadStream(path, {
    flag      : 'r',
    encoding  : null,
    autoClose : true
  });

  this.on('pause', function () {
    localStream.pause();
  });

  this.on('resume', function () {
    localStream.resume();
  });

  localStream.on('data', function (data) {
    self.emit('packet', new Packets.LocalDataFilePacket(data));
  });

  localStream.on('error', function (err) {
    self._loadError = err;
    localStream.emit('end');
  });

  localStream.on('end', function () {
    self.emit('packet', new Packets.EmptyPacket());
  });
};

Query.prototype.stream = function(options) {
  var self = this;

  options = copyStreamOptions(options);
  options.objectMode = true;

  if (options.highWaterMark !== undefined &&
      (!Number.isInteger(options.highWaterMark) || options.highWaterMark < 0)) {
    throw new TypeError('stream highWaterMark must be a non-negative integer');
  }

  var stream = new Readable(options);
  var pausedForBackpressure = false;

  stream._read = function() {
    if (pausedForBackpressure) {
      pausedForBackpressure = false;
      publishBackpressure(self, stream, 'resume');
    }

    self._connection && self._connection.resume();
  };

  this.on('result', function(row, i) {
    if (!stream.push(row)) {
      pausedForBackpressure = true;
      publishBackpressure(self, stream, 'pause');
      self._connection && self._connection.pause();
    }
    stream.emit('result', row, i);
  });

  this.on('error', function(err) {
    stream.emit('error', err);
  });

  this.on('end', function() {
    stream.push(null);
  });

  this.on('fields', function(fields, i) {
    stream.emit('fields', fields, i);
  });

  return stream;
};

function copyStreamOptions(options) {
  var copy = {};
  var source = options || {};

  for (var key in source) {
    copy[key] = source[key];
  }

  return copy;
}

function publishBackpressure(query, stream, action) {
  if (!StreamBackpressureChannel.hasSubscribers) {
    return;
  }

  StreamBackpressureChannel.publish({
    action        : action,
    sql           : query.sql,
    threadId      : query._connection && query._connection.threadId,
    highWaterMark : stream.readableHighWaterMark
  });
}
