'use strict';

var assert = require('assert');
var Buffer = require('safe-buffer').Buffer;
var common = require('../../common');
var AuthPlugins = require('../../../lib/protocol/AuthPlugins');

var password = 'modern-password';
var server = common.createFakeServer();

server.listen(0, function (err) {
  assert.ifError(err);

  var connection = common.createConnection({
    port     : server.port(),
    user     : 'modern-user',
    password : password
  });

  connection.connect(function (err) {
    assert.ifError(err);
    connection.destroy();
    server.destroy();
  });
});

server.on('connection', function (incomingConnection) {
  incomingConnection.handshake({
    serverCapabilities1 : common.ClientConstants.CLIENT_PROTOCOL_41,
    serverCapabilities2 : common.ClientConstants.CLIENT_PLUGIN_AUTH >>> 16,
    scrambleLength      : 21,
    pluginData          : 'caching_sha2_password'
  });

  incomingConnection.on('clientAuthentication', function (packet) {
    assert.strictEqual(packet.authPluginName, 'caching_sha2_password');
    assert.deepStrictEqual(
      packet.scrambleBuff,
      AuthPlugins.calculateCachingSha2Token(password, incomingConnection._handshakeInitializationPacket.scrambleBuff())
    );

    incomingConnection.authMoreData(Buffer.from([0x03]), false);
    incomingConnection.ok();
  });
});
