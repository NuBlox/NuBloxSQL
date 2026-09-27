'use strict';

var assert = require('assert');
var common = require('../common');
var path = require('path');
var test = require('utest');

var ConnectionConfig = require(path.resolve(common.lib, 'ConnectionConfig'));
var CredentialProvider = require(path.resolve(common.lib, 'CredentialProvider'));
var Handshake = require(path.resolve(common.lib, 'protocol/sequences/Handshake'));

test('CredentialProvider', {
  'resolves a password string without exposing it in context': function() {
    var observed;
    var config = new ConnectionConfig({
      host               : 'db.internal',
      user               : 'app',
      database           : 'core',
      credentialProvider : function(context) {
        observed = context;
        return 'token-1';
      }
    });

    var credentials = CredentialProvider.resolve(config);
    CredentialProvider.apply(config, credentials);

    assert.strictEqual(config.password, 'token-1');
    assert.strictEqual(observed.host, 'db.internal');
    assert.strictEqual(observed.user, 'app');
    assert.strictEqual(observed.database, 'core');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(observed, 'password'), false);
    assert.strictEqual(Object.isFrozen(observed), true);
  },

  'can rotate user database and password together': function() {
    var config = new ConnectionConfig({
      user               : 'bootstrap',
      database           : 'bootstrap_db',
      credentialProvider : function() {
        return {
          user     : 'ephemeral-user',
          password : 'ephemeral-token',
          database : 'tenant_db'
        };
      }
    });

    CredentialProvider.apply(config, CredentialProvider.resolve(config));

    assert.strictEqual(config.user, 'ephemeral-user');
    assert.strictEqual(config.password, 'ephemeral-token');
    assert.strictEqual(config.database, 'tenant_db');
  },

  'supports asynchronous credential resolution': function(done) {
    var config = new ConnectionConfig({
      credentialProvider: function() {
        return global.Promise.resolve({password: 'async-token'});
      }
    });

    CredentialProvider.resolve(config).then(function(credentials) {
      CredentialProvider.apply(config, credentials);
      assert.strictEqual(config.password, 'async-token');
      done();
    }, done);
  },

  'rejects invalid provider results': function() {
    var config = new ConnectionConfig({
      credentialProvider: function() {
        return {user: 'missing-password'};
      }
    });

    assert.throws(function() {
      CredentialProvider.resolve(config);
    }, function(error) {
      return error.code === 'CREDENTIAL_PROVIDER_INVALID_RESULT' && error.fatal === true;
    });
  },

  'marks provider failures fatal without replacing their code': function() {
    var config = new ConnectionConfig({
      credentialProvider: function() {
        var error = new Error('secret manager unavailable');
        error.code = 'SECRET_MANAGER_UNAVAILABLE';
        throw error;
      }
    });

    assert.throws(function() {
      CredentialProvider.resolve(config);
    }, function(error) {
      return error.code === 'SECRET_MANAGER_UNAVAILABLE' && error.fatal === true;
    });
  },

  'resolves credentials once before handshake authentication': function(done) {
    var calls = 0;
    var config = new ConnectionConfig({
      credentialProvider: function() {
        calls++;
        return global.Promise.resolve({password: 'handshake-token'});
      }
    });
    var handshake = new Handshake({config: config}, function() {});

    handshake._sendResolvedCredentials = function() {
      assert.strictEqual(config.password, 'handshake-token');
      assert.strictEqual(calls, 1);
      assert.strictEqual(handshake._credentialsResolved, true);
      done();
    };

    handshake._sendCredentials();
  },

  'validates credentialProvider configuration': function() {
    assert.throws(function() {
      return new ConnectionConfig({credentialProvider: {password: 'x'}});
    }, /credentialProvider must be a function/);
  }
});
