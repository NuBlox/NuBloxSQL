'use strict';

var assert = require('assert');
var common = require('../../common');
var path = require('path');
var test = require('utest');
var Zlib = require('zlib');

var CompressedProtocol = require(path.resolve(common.lib, 'protocol/CompressedProtocol'));

function readUInt24(buffer, offset) {
  return buffer[offset] |
    (buffer[offset + 1] << 8) |
    (buffer[offset + 2] << 16);
}

function writeUInt24(buffer, value, offset) {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >>> 8) & 0xff;
  buffer[offset + 2] = (value >>> 16) & 0xff;
}

test('CompressedProtocol', {
  'compresses and restores a compressible payload': function() {
    var encoder = new CompressedProtocol();
    var decoder = new CompressedProtocol();
    var original = Buffer.alloc(4096, 0x61);
    var decoded;

    encoder.activate('zlib');
    decoder.activate('zlib');

    var frame = encoder.encode(original);
    assert.strictEqual(frame[3], 0);
    assert.strictEqual(readUInt24(frame, 4), original.length);
    assert.ok(readUInt24(frame, 0) < original.length);

    decoder.write(frame, function(payload) {
      decoded = payload;
    });

    assert.deepStrictEqual(decoded, original);
  },

  'uses an uncompressed compressed-frame when deflate is not beneficial': function() {
    var encoder = new CompressedProtocol();
    var decoder = new CompressedProtocol();
    var original = Buffer.from([1, 2, 3, 4]);
    var decoded;

    encoder.activate('zlib');
    decoder.activate('zlib');

    var frame = encoder.encode(original);
    assert.strictEqual(readUInt24(frame, 4), 0);
    assert.strictEqual(readUInt24(frame, 0), original.length);

    decoder.write(frame, function(payload) {
      decoded = payload;
    });

    assert.deepStrictEqual(decoded, original);
  },

  'accepts fragmented compressed frames': function() {
    var encoder = new CompressedProtocol();
    var decoder = new CompressedProtocol();
    var original = Buffer.alloc(1024, 0x42);
    var decoded;

    encoder.activate('zlib');
    decoder.activate('zlib');

    var frame = encoder.encode(original);
    decoder.write(frame.slice(0, 2), function() {});
    decoder.write(frame.slice(2, 7), function() {});
    decoder.write(frame.slice(7), function(payload) {
      decoded = payload;
    });

    assert.deepStrictEqual(decoded, original);
  },

  'increments compressed sequence ids independently and can reset them': function() {
    var encoder = new CompressedProtocol();

    encoder.activate('zlib');

    var first = encoder.encode(Buffer.from('first'));
    var second = encoder.encode(Buffer.from('second'));

    assert.strictEqual(first[3], 0);
    assert.strictEqual(second[3], 1);

    encoder.resetPacketNumber();
    var reset = encoder.encode(Buffer.from('reset'));
    assert.strictEqual(reset[3], 0);
  },

  'rejects compressed frames received out of sequence': function() {
    var decoder = new CompressedProtocol();
    var frame = Buffer.alloc(7);

    decoder.activate('zlib');
    frame[3] = 1;

    assert.throws(function() {
      decoder.write(frame, function() {});
    }, function(error) {
      return error.code === 'PROTOCOL_COMPRESSED_PACKETS_OUT_OF_ORDER' && error.fatal === true;
    });
  },

  'bounds decompression to the declared uncompressed length': function() {
    var decoder = new CompressedProtocol();
    var original = Buffer.alloc(4096, 0x61);
    var compressed = Zlib.deflateSync(original);
    var frame = Buffer.alloc(7 + compressed.length);

    decoder.activate('zlib');
    writeUInt24(frame, compressed.length, 0);
    frame[3] = 0;
    writeUInt24(frame, 32, 4);
    compressed.copy(frame, 7);

    assert.throws(function() {
      decoder.write(frame, function() {});
    }, function(error) {
      return error.code === 'PROTOCOL_COMPRESSION_INFLATE_ERROR' && error.fatal === true;
    });
  },

  'rejects inflated output that does not match the declared size': function() {
    var decoder = new CompressedProtocol();
    var original = Buffer.from('NuBloxSQL compression');
    var compressed = Zlib.deflateSync(original);
    var frame = Buffer.alloc(7 + compressed.length);

    decoder.activate('zlib');
    writeUInt24(frame, compressed.length, 0);
    frame[3] = 0;
    writeUInt24(frame, original.length + 1, 4);
    compressed.copy(frame, 7);

    assert.throws(function() {
      decoder.write(frame, function() {});
    }, function(error) {
      return error.code === 'PROTOCOL_COMPRESSION_LENGTH_MISMATCH' && error.fatal === true;
    });
  }
});
