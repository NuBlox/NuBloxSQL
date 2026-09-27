'use strict';

var assert = require('assert');
var common = require('../common');
var path = require('path');
var test = require('utest');

var ConnectionConfig = require(path.resolve(common.lib, 'ConnectionConfig'));

test('Resource limits', {
  'uses bounded defaults': function() {
    var config = new ConnectionConfig();

    assert.strictEqual(config.maxInboundPacketSize, 64 * 1024 * 1024);
    assert.strictEqual(config.maxMetadataSize, 8 * 1024 * 1024);
    assert.strictEqual(config.maxResultSetColumns, 4096);
  },

  'accepts custom resource limits': function() {
    var config = new ConnectionConfig({
      maxInboundPacketSize : 128 * 1024 * 1024,
      maxMetadataSize      : 16 * 1024 * 1024,
      maxResultSetColumns  : 8192
    });

    assert.strictEqual(config.maxInboundPacketSize, 128 * 1024 * 1024);
    assert.strictEqual(config.maxMetadataSize, 16 * 1024 * 1024);
    assert.strictEqual(config.maxResultSetColumns, 8192);
  },

  'rejects unsafe resource limit values': function() {
    var names = [
      'maxInboundPacketSize',
      'maxMetadataSize',
      'maxResultSetColumns'
    ];

    names.forEach(function(name) {
      [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].forEach(function(value) {
        var options = {};
        options[name] = value;

        assert.throws(function() {
          return new ConnectionConfig(options);
        }, new RegExp(name + ' must be a positive safe integer'));
      });
    });
  }
});
