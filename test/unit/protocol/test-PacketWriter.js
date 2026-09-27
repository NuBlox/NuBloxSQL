'use strict';

var assert = require('assert');
var common = require('../../common');
var test = require('utest');

var PacketWriter = common.PacketWriter;
var Parser = common.Parser;

test('PacketWriter', {
  'preserves bytes across geometric growth': function() {
    var writer = new PacketWriter();
    var chunk = Buffer.alloc(31, 0x5a);
    var count = 4096;

    for (var i = 0; i < count; i++) {
      writer.writeBuffer(chunk);
    }

    assert.strictEqual(writer._offset, chunk.length * count);
    assert.ok(writer._buffer.length >= writer._offset);
    assert.ok(writer._buffer.length < writer._offset * 2);

    for (var offset = 0; offset < writer._offset; offset += chunk.length) {
      assert.deepStrictEqual(writer._buffer.slice(offset, offset + chunk.length), chunk);
    }
  },

  'frames payload without changing its bytes': function() {
    var writer = new PacketWriter();
    var parser = new Parser();
    var payload = Buffer.from('NuBloxSQL packet writer');

    writer.writeBuffer(payload);
    var wire = writer.toBuffer(parser);

    var declaredLength = wire[0] | (wire[1] << 8) | (wire[2] << 16);
    assert.strictEqual(declaredLength, payload.length);
    assert.strictEqual(wire[3], 0);
    assert.deepStrictEqual(wire.slice(4), payload);
  },

  'writes filler bytes explicitly with unsafe backing buffers': function() {
    var writer = new PacketWriter();

    writer.writeFiller(4096);

    assert.strictEqual(writer._offset, 4096);
    for (var i = 0; i < writer._offset; i++) {
      assert.strictEqual(writer._buffer[i], 0);
    }
  }
});
