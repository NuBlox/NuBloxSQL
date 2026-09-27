'use strict';

var assert = require('assert');
var common = require('../common');
var path = require('path');
var test = require('utest');

var ConnectionConfig = require(path.resolve(common.lib, 'ConnectionConfig'));

test('Resource limits', {
  'defaults maxInboundPacketSize to 64 MiB': function() {
    var config = new ConnectionConfig();

    assert.strictEqual(config.maxInboundPacketSize, 64 * 1024 * 1024);
  },

  'accepts a custom maxInboundPacketSize': function() {
    var config = new ConnectionConfig({maxInboundPacketSize: 128 * 1024 * 1024});

    assert.strictEqual(config.maxInboundPacketSize, 128 * 1024 * 1024);
  },

  'rejects unsafe maxInboundPacketSize values': function() {
    [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].forEach(function(value) {
      assert.throws(function() {
        return new ConnectionConfig({maxInboundPacketSize: value});
      }, /maxInboundPacketSize must be a positive safe integer/);
    });
  }
});
