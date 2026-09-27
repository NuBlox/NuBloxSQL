'use strict';

var assert = require('assert');
var common = require('../common');
var test = require('utest');
var Zlib = require('zlib');

var Client = common.ClientConstants;
var ConnectionConfig = common.ConnectionConfig;

function supportsZstd() {
  return typeof Zlib.zstdCompressSync === 'function' &&
    typeof Zlib.zstdDecompressSync === 'function';
}

test('ConnectionConfig compression policy', {
  'defaults to uncompressed without advertising compression capabilities': function() {
    var config = new ConnectionConfig({});

    assert.deepStrictEqual(config.compressionAlgorithms, ['uncompressed']);
    assert.strictEqual(config.compressionAlgorithm, 'uncompressed');
    assert.strictEqual(config.clientFlags & Client.CLIENT_COMPRESS, 0);
    assert.strictEqual(config.clientFlags & Client.CLIENT_ZSTD_COMPRESSION_ALGORITHM, 0);
  },

  'advertises zlib when explicitly permitted': function() {
    var config = new ConnectionConfig({
      compressionAlgorithms: ['zlib', 'uncompressed']
    });

    assert.deepStrictEqual(config.compressionAlgorithms, ['zlib', 'uncompressed']);
    assert.notStrictEqual(config.clientFlags & Client.CLIENT_COMPRESS, 0);
  },

  'advertises zstd and preserves ordered fallback policy when runtime support exists': function() {
    if (!supportsZstd()) {
      return;
    }

    var config = new ConnectionConfig({
      compressionAlgorithms : ['zstd', 'zlib', 'uncompressed'],
      zstdCompressionLevel  : 7
    });

    assert.deepStrictEqual(config.compressionAlgorithms, ['zstd', 'zlib', 'uncompressed']);
    assert.strictEqual(config.zstdCompressionLevel, 7);
    assert.notStrictEqual(config.clientFlags & Client.CLIENT_ZSTD_COMPRESSION_ALGORITHM, 0);
    assert.notStrictEqual(config.clientFlags & Client.CLIENT_COMPRESS, 0);
  },

  'uses zstd level 3 by default': function() {
    if (!supportsZstd()) {
      return;
    }

    var config = new ConnectionConfig({compressionAlgorithms: ['zstd']});
    assert.strictEqual(config.zstdCompressionLevel, 3);
  },

  'rejects invalid zstd compression levels': function() {
    [0, 23, 1.5].forEach(function(level) {
      assert.throws(function() {
        return new ConnectionConfig({zstdCompressionLevel: level});
      }, /zstdCompressionLevel must be an integer from 1 to 22/);
    });
  },

  'normalizes a comma separated policy': function() {
    var config = new ConnectionConfig({
      compressionAlgorithms: ' ZLIB, uncompressed,zlib '
    });

    assert.deepStrictEqual(config.compressionAlgorithms, ['zlib', 'uncompressed']);
  },

  'supports the legacy compress boolean as a compatibility alias': function() {
    var config = new ConnectionConfig({compress: true});

    assert.deepStrictEqual(config.compressionAlgorithms, ['zlib', 'uncompressed']);
    assert.notStrictEqual(config.clientFlags & Client.CLIENT_COMPRESS, 0);
  },

  'does not allow raw flags to enable unrequested compression': function() {
    var config = new ConnectionConfig({flags: '+COMPRESS,+ZSTD_COMPRESSION_ALGORITHM'});

    assert.strictEqual(config.clientFlags & Client.CLIENT_COMPRESS, 0);
    assert.strictEqual(config.clientFlags & Client.CLIENT_ZSTD_COMPRESSION_ALGORITHM, 0);
  },

  'rejects unknown algorithms': function() {
    assert.throws(function() {
      return new ConnectionConfig({compressionAlgorithms: ['brotli']});
    }, /Unknown compression algorithm/);
  }
});
