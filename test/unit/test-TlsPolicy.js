'use strict';

var assert = require('assert');
var common = require('../common');
var path = require('path');
var test = require('utest');

var ConnectionConfig = require(path.resolve(common.lib, 'ConnectionConfig'));
var TlsPolicy = require(path.resolve(common.lib, 'TlsPolicy'));

test('TlsPolicy', {
  'leaves TLS options unchanged when disabled': function() {
    var ssl = {minVersion: 'TLSv1.1', rejectUnauthorized: false};
    var result = TlsPolicy.apply(ssl);

    assert.strictEqual(result.name, null);
    assert.strictEqual(result.ssl, ssl);
    assert.strictEqual(result.ssl.minVersion, 'TLSv1.1');
    assert.strictEqual(result.ssl.rejectUnauthorized, false);
  },

  'modern requires TLS 1.2 and certificate verification': function() {
    var ssl = {};
    var result = TlsPolicy.apply(ssl, 'modern');

    assert.strictEqual(result.name, 'modern');
    assert.strictEqual(result.ssl.minVersion, 'TLSv1.2');
    assert.strictEqual(result.ssl.rejectUnauthorized, true);
  },

  'strict requires TLS 1.3 and certificate verification': function() {
    var ssl = {};
    var result = TlsPolicy.apply(ssl, 'strict');

    assert.strictEqual(result.name, 'strict');
    assert.strictEqual(result.ssl.minVersion, 'TLSv1.3');
    assert.strictEqual(result.ssl.rejectUnauthorized, true);
  },

  'modern permits an explicitly stronger minimum version': function() {
    var result = TlsPolicy.apply({minVersion: 'TLSv1.3'}, 'modern');

    assert.strictEqual(result.ssl.minVersion, 'TLSv1.3');
  },

  'rejects a weaker explicit minimum version': function() {
    assert.throws(function() {
      TlsPolicy.apply({minVersion: 'TLSv1.1'}, 'modern');
    }, /requires minVersion TLSv1.2 or newer/);
  },

  'rejects an incompatible maximum version': function() {
    assert.throws(function() {
      TlsPolicy.apply({maxVersion: 'TLSv1.2'}, 'strict');
    }, /incompatible with maxVersion TLSv1.2/);
  },

  'rejects disabled certificate verification': function() {
    assert.throws(function() {
      TlsPolicy.apply({rejectUnauthorized: false}, 'modern');
    }, /requires certificate verification/);
  },

  'requires TLS to be enabled': function() {
    assert.throws(function() {
      TlsPolicy.apply(false, 'modern');
    }, /tlsPolicy requires ssl to be enabled/);
  },

  'rejects unknown policy names': function() {
    assert.throws(function() {
      TlsPolicy.apply({}, 'legacy');
    }, /tlsPolicy must be modern or strict/);
  },

  'integrates modern policy through ConnectionConfig': function() {
    var original = {ca: 'test-ca'};
    var config = new ConnectionConfig({
      ssl       : original,
      tlsPolicy : 'modern'
    });

    assert.strictEqual(config.tlsPolicy, 'modern');
    assert.strictEqual(config.ssl.minVersion, 'TLSv1.2');
    assert.strictEqual(config.ssl.rejectUnauthorized, true);
    assert.strictEqual(config.ssl.ca, 'test-ca');
    assert.notStrictEqual(config.ssl, original);
    assert.strictEqual(original.minVersion, undefined);
  },

  'preserves raw SSL behaviour without a policy': function() {
    var config = new ConnectionConfig({
      ssl: {
        minVersion         : 'TLSv1.1',
        rejectUnauthorized : false
      }
    });

    assert.strictEqual(config.tlsPolicy, null);
    assert.strictEqual(config.ssl.minVersion, 'TLSv1.1');
    assert.strictEqual(config.ssl.rejectUnauthorized, false);
  }
});
