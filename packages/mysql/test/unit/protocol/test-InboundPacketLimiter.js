'use strict';

var assert = require('assert');
var common = require('../../common');
var path = require('path');
var test = require('utest');

var InboundPacketLimiter = require(path.resolve(common.lib, 'protocol/InboundPacketLimiter'));

function packet(length, sequenceId, payloadByte) {
  var buffer = Buffer.alloc(4 + length, payloadByte === undefined ? 0x61 : payloadByte);
  buffer[0] = length & 0xff;
  buffer[1] = (length >>> 8) & 0xff;
  buffer[2] = (length >>> 16) & 0xff;
  buffer[3] = sequenceId || 0;
  return buffer;
}

test('InboundPacketLimiter', {
  'accepts packets within the configured limit': function() {
    var limiter = new InboundPacketLimiter(8);

    assert.doesNotThrow(function() {
      limiter.write(packet(8, 0));
    });
  },

  'rejects an oversized packet from its header before receiving the payload': function() {
    var limiter = new InboundPacketLimiter(8);
    var header = packet(9, 0).slice(0, 4);
    var error;

    try {
      limiter.write(header);
    } catch (err) {
      error = err;
    }

    assert.ok(error);
    assert.strictEqual(error.code, 'PROTOCOL_INBOUND_PACKET_TOO_LARGE');
    assert.strictEqual(error.fatal, true);
    assert.strictEqual(error.packetLength, 9);
    assert.strictEqual(error.limit, 8);
  },

  'handles a fragmented header and payload without losing framing state': function() {
    var limiter = new InboundPacketLimiter(16);
    var buffer = packet(12, 0);

    assert.doesNotThrow(function() {
      limiter.write(buffer.slice(0, 2));
      limiter.write(buffer.slice(2, 7));
      limiter.write(buffer.slice(7));
    });
  },

  'tracks consecutive packets independently': function() {
    var limiter = new InboundPacketLimiter(8);
    var combined = Buffer.concat([
      packet(8, 0, 0x11),
      packet(8, 1, 0x22)
    ]);

    assert.doesNotThrow(function() {
      limiter.write(combined);
    });
  },

  'rejects invalid limits': function() {
    [0, -1, 1.5, NaN].forEach(function(value) {
      assert.throws(function() {
        return new InboundPacketLimiter(value);
      }, /maxBytes must be a positive integer/);
    });
  }
});
