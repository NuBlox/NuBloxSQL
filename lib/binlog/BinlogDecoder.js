'use strict';

var BaseDecoder = require('./BinlogEventDecoder');
var EventTypes  = require('./EventTypes');
var GtidDecoder = require('./GtidEventDecoder');
var Util        = require('util');

module.exports = BinlogDecoder;
Util.inherits(BinlogDecoder, BaseDecoder);

function BinlogDecoder(options) {
  BaseDecoder.call(this, options);
}

BinlogDecoder.prototype.decode = function decode(input) {
  var event = BaseDecoder.prototype.decode.call(this, input);

  switch (event.type) {
    case EventTypes.GTID_LOG_EVENT:
      GtidDecoder.decodeGtidEvent(event, event.payload, false);
      break;
    case EventTypes.ANONYMOUS_GTID_LOG_EVENT:
      GtidDecoder.decodeGtidEvent(event, event.payload, true);
      break;
    case EventTypes.PREVIOUS_GTIDS_LOG_EVENT:
      GtidDecoder.decodePreviousGtidsEvent(event, event.payload);
      break;
  }

  return event;
};
