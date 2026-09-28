'use strict';

var assert = require('assert');
var common = require('../../common');
var NegotiatedClientFlags = require('../../../lib/protocol/NegotiatedClientFlags');

var queryAttributes = common.ClientConstants.CLIENT_QUERY_ATTRIBUTES;
var protocol41 = common.ClientConstants.CLIENT_PROTOCOL_41;

assert.strictEqual(
  NegotiatedClientFlags.forCommand({
    config    : {clientFlags: protocol41 | queryAttributes},
    _protocol : {
      _handshakeInitializationPacket: {
        serverCapabilities1 : protocol41,
        serverCapabilities2 : 0
      }
    }
  }) & queryAttributes,
  0,
  'commands must not use query attributes when the physical server did not negotiate them'
);

assert.strictEqual(
  NegotiatedClientFlags.forCommand({
    config    : {clientFlags: protocol41 | queryAttributes},
    _protocol : {
      _handshakeInitializationPacket: {
        serverCapabilities1 : protocol41,
        serverCapabilities2 : queryAttributes >>> 16
      }
    }
  }) & queryAttributes,
  queryAttributes,
  'commands may use query attributes when the physical server advertises them'
);

assert.strictEqual(
  NegotiatedClientFlags.forCommand({
    config    : {clientFlags: protocol41 | queryAttributes},
    _protocol : {_handshakeInitializationPacket: true}
  }) & queryAttributes,
  queryAttributes,
  'synthetic protocol users without a handshake packet retain configured flags'
);
