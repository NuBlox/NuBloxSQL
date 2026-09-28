'use strict';

var assert = require('assert');
var path = require('path');

var ClientConstants = require(path.resolve(__dirname, '../../../lib/protocol/constants/client'));
var ConnectionConfig = require(path.resolve(__dirname, '../../../lib/ConnectionConfig'));
var Handshake = require(path.resolve(__dirname, '../../../lib/protocol/sequences/Handshake'));

var QA = ClientConstants.CLIENT_QUERY_ATTRIBUTES;
var defaults = new ConnectionConfig({});
assert.ok(defaults.clientFlags & QA, 'CLIENT_QUERY_ATTRIBUTES should be requested by default');

var disabled = new ConnectionConfig({flags: '-QUERY_ATTRIBUTES'});
assert.strictEqual(disabled.clientFlags & QA, 0);

var unsupportedConfig = new ConnectionConfig({});
var unsupported = new Handshake({config: unsupportedConfig});
unsupported._negotiateCompression = function negotiateCompression() {
  return true;
};
unsupported._sendCredentials = function sendCredentials() {};
unsupported.HandshakeInitializationPacket({
  protocol41          : true,
  serverCapabilities1 : ClientConstants.CLIENT_PROTOCOL_41,
  serverCapabilities2 : ClientConstants.CLIENT_PLUGIN_AUTH >>> 16
});
assert.strictEqual(unsupportedConfig.clientFlags & QA, 0);

var supportedConfig = new ConnectionConfig({});
var supported = new Handshake({config: supportedConfig});
supported._negotiateCompression = function negotiateCompression() {
  return true;
};
supported._sendCredentials = function sendCredentials() {};
supported.HandshakeInitializationPacket({
  protocol41          : true,
  serverCapabilities1 : ClientConstants.CLIENT_PROTOCOL_41,
  serverCapabilities2 : (ClientConstants.CLIENT_PLUGIN_AUTH | QA) >>> 16
});
assert.ok(supportedConfig.clientFlags & QA);
