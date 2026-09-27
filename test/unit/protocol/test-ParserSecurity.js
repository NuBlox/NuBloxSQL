'use strict';

var assert = require('assert');
var common = require('../../common');
var path = require('path');
var test = require('utest');

var Parser = require(path.resolve(common.lib, 'protocol/Parser'));

function packet(payload, sequenceId) {
  var header = Buffer.alloc(4);
  header[0] = payload.length & 0xff;
  header[1] = (payload.length >>> 8) & 0xff;
  header[2] = (payload.length >>> 16) & 0xff;
  header[3] = sequenceId || 0;
  return Buffer.concat([header, payload]);
}

test('Parser security boundaries', {
  'rejects direct reads beyond buffered data before allocation': function() {
    var parser = new Parser();
    parser.append(Buffer.from([1, 2, 3]));

    assert.throws(function() {
      parser.parseBuffer(1024 * 1024);
    }, function(error) {
      return error.code === 'PARSER_READ_PAST_END';
    });
  },

  'rejects length-coded buffers larger than their packet': function() {
    var errors = [];
    var parser = new Parser({
      onError : function(error) {
        errors.push(error);
      },
      onPacket: function() {
        parser.parseLengthCodedBuffer();
      }
    });

    parser.write(packet(Buffer.from([0xfc, 0xff, 0xff]), 0));

    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].code, 'PARSER_READ_PAST_END');
  },

  'does not scan a null-terminated value into the next packet': function() {
    var errors = [];
    var packets = 0;
    var parser = new Parser({
      onError : function(error) {
        errors.push(error);
      },
      onPacket: function() {
        packets++;
        if (packets === 1) {
          parser.parseNullTerminatedString();
        } else {
          parser.parsePacketTerminatedBuffer();
        }
      }
    });

    parser.write(Buffer.concat([
      packet(Buffer.from('abc'), 0),
      packet(Buffer.from([0x00]), 1)
    ]));

    assert.strictEqual(packets, 2);
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].code, 'PARSER_MISSING_NULL_BYTE');
  },

  'rejects fixed-width reads beyond the packet boundary': function() {
    var errors = [];
    var parser = new Parser({
      onError : function(error) {
        errors.push(error);
      },
      onPacket: function() {
        parser.parseUnsignedNumber(4);
      }
    });

    parser.write(packet(Buffer.from([0x01]), 0));

    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].code, 'PARSER_READ_PAST_END');
  },

  'rejects unsafe or negative requested read lengths': function() {
    var parser = new Parser();
    parser.append(Buffer.from([1, 2, 3]));

    [-1, 1.5, Number.MAX_SAFE_INTEGER + 1].forEach(function(length) {
      assert.throws(function() {
        parser.parseString(length);
      }, function(error) {
        return error.code === 'PARSER_INVALID_LENGTH';
      });
    });
  }
});
