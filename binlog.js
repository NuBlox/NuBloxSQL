'use strict';

var BinlogEventDecoder = require('./lib/binlog/BinlogEventDecoder');
var EventTypes         = require('./lib/binlog/EventTypes');

function createDecoder(options) {
  return new BinlogEventDecoder(options);
}

module.exports = createDecoder;
module.exports.createDecoder = createDecoder;
module.exports.BinlogEventDecoder = BinlogEventDecoder;
module.exports.EventTypes = EventTypes;
