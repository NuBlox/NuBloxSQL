'use strict';

var BinlogDump = require('./protocol/sequences/BinlogDump');

exports.decorateConnection = function decorateConnection(connection) {
  if (!connection || connection.binlogDump) {
    return connection;
  }

  connection._nubloxReplicationConnection = true;

  connection.binlogDump = function binlogDump(options, callback) {
    options = options || {};

    var sequenceOptions = Object.create(options);
    sequenceOptions.connection = connection;

    connection._implyConnect();
    return connection._protocol._enqueue(new BinlogDump(sequenceOptions, callback));
  };

  return connection;
};
