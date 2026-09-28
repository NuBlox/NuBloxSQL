'use strict';

var BinlogEventDecoder = require('./lib/binlog/BinlogEventDecoder');
var BinlogReplication  = require('./lib/BinlogReplication');
var EventTypes         = require('./lib/binlog/EventTypes');
var Mysql              = require('./index');

function createDecoder(options) {
  return new BinlogEventDecoder(options);
}

function createReplicationConnection(config) {
  return BinlogReplication.decorateConnection(Mysql.createConnection(config));
}

module.exports = createDecoder;
module.exports.createDecoder = createDecoder;
module.exports.createReplicationConnection = createReplicationConnection;
module.exports.BinlogEventDecoder = BinlogEventDecoder;
module.exports.EventTypes = EventTypes;
