'use strict';

var assert = require('assert');
var common = require('../common');
var test = require('utest');

var Client = common.ClientConstants;
var ConnectionConfig = common.ConnectionConfig;

test('ConnectionConfig compression policy', {
  'defaults to uncompressed without advertising CLIENT_COMPRESS': function() {
    var config = new ConnectionConfig({});

    assert.deepStrictEqual(config.compressionAlgorithms, ['uncompressed']);
    assert.strictEqual(config.compressionAlgorithm, 'uncompressed');
    assert.strictEqual(config.clientFlags & Client.CLIENT_COMPRESS, 0);
  },

  'advertises zlib when explicitly permitted': function() {
    var config = new ConnectionConfig({
      compressionAlgorithms: ['zlib', 'uncompressed']
    });

    assert.deepStrictEqual(config.compressionAlgorithms, ['zlib', 'uncompressed']);
    assert.notStrictEqual(config.clientFlags & Client.CLIENT_COMPRESS, 0);
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

  'does not allow raw flags to enable unsupported compression': function() {
    var config = new ConnectionConfig({flags: '+COMPRESS'});

    assert.strictEqual(config.clientFlags & Client.CLIENT_COMPRESS, 0);
  },

  'rejects zstd until its handshake byte and codec are implemented': function() {
    assert.throws(function() {
      return new ConnectionConfig({compressionAlgorithms: ['zstd']});
    }, /zstd compression is not yet enabled/);
  },

  'rejects unknown algorithms': function() {
    assert.throws(function() {
      return new ConnectionConfig({compressionAlgorithms: ['brotli']});
    }, /Unknown compression algorithm/);
  }
});
