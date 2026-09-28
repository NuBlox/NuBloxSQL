'use strict';

var ClientConstants = require('./constants/client');

exports.forCommand = forCommand;

function forCommand(connection) {
  var flags = connection && connection.config
    ? connection.config.clientFlags || 0
    : 0;
  var protocol = connection && connection._protocol;
  var handshake = protocol && protocol._handshakeInitializationPacket;

  if (!handshake || typeof handshake !== 'object') {
    return flags;
  }

  var serverCapabilities = (handshake.serverCapabilities1 || 0) |
    ((handshake.serverCapabilities2 || 0) << 16);

  if (!(serverCapabilities & ClientConstants.CLIENT_QUERY_ATTRIBUTES)) {
    flags &= ~ClientConstants.CLIENT_QUERY_ATTRIBUTES;
  }

  return flags;
}
