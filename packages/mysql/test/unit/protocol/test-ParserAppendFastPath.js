'use strict';

var assert = require('assert');
var common = require('../../common');
var test = require('utest');

var Parser = common.Parser;

test('Parser append fast path', {
  'reuses a single buffer when no bytes need to be retained': function() {
    var parser = new Parser();
    var chunk = Buffer.from('NuBloxSQL');

    parser.append(chunk);

    assert.strictEqual(parser._buffer, chunk);
    assert.strictEqual(parser._offset, 0);
  },

  'parses a payload supplied after its complete header': function() {
    var payload = Buffer.from('abc');
    var parsed;
    var parser = new Parser({
      onPacket: function(header) {
        assert.strictEqual(header.length, payload.length);
        parsed = parser.parsePacketTerminatedBuffer();
      }
    });

    parser.write(Buffer.from([payload.length, 0, 0, 0]));
    assert.strictEqual(parsed, undefined);

    parser.write(payload);
    assert.deepStrictEqual(parsed, payload);
  },

  'retains an existing payload prefix when one new buffer completes the packet': function() {
    var payload = Buffer.from('abc');
    var parsed;
    var parser = new Parser({
      onPacket: function() {
        parsed = parser.parsePacketTerminatedBuffer();
      }
    });

    parser.write(Buffer.concat([
      Buffer.from([payload.length, 0, 0, 0]),
      payload.slice(0, 1)
    ]));
    assert.strictEqual(parsed, undefined);

    parser.write(payload.slice(1));
    assert.deepStrictEqual(parsed, payload);
  },

  'preserves the multi-buffer fallback for heavily fragmented payloads': function() {
    var payload = Buffer.from('abc');
    var parsed;
    var parser = new Parser({
      onPacket: function() {
        parsed = parser.parsePacketTerminatedBuffer();
      }
    });

    parser.write(Buffer.from([payload.length, 0, 0, 0]));
    parser.write(payload.slice(0, 1));
    assert.strictEqual(parsed, undefined);

    parser.write(payload.slice(1));
    assert.deepStrictEqual(parsed, payload);
  }
});
