'use strict';

var PacketReader = require('./PacketReader').PacketReader;
var capabilities = require('./capabilities');

function hasCapability(flags, capability) {
  return (flags & capability) !== 0;
}

function parseHandshakeV10(payload) {
  var reader = new PacketReader(payload);
  var protocolVersion = reader.uint8();
  if (protocolVersion !== 10) {
    throw new RangeError('Unsupported MySQL protocol version: ' + protocolVersion);
  }

  var serverVersion = reader.nullTerminatedString('utf8');
  var connectionId = reader.uint32LE();
  var authPluginDataPart1 = reader.bytes(8);
  reader.skip(1);

  if (!reader.remaining()) {
    return {
      protocolVersion: protocolVersion,
      serverVersion: serverVersion,
      connectionId: connectionId,
      capabilityFlags: 0,
      characterSet: null,
      statusFlags: null,
      authPluginData: Buffer.from(authPluginDataPart1),
      authPluginName: null
    };
  }

  var capabilityLower = reader.uint16LE();
  if (!reader.remaining()) {
    return {
      protocolVersion: protocolVersion,
      serverVersion: serverVersion,
      connectionId: connectionId,
      capabilityFlags: capabilityLower >>> 0,
      characterSet: null,
      statusFlags: null,
      authPluginData: Buffer.from(authPluginDataPart1),
      authPluginName: null
    };
  }

  var characterSet = reader.uint8();
  var statusFlags = reader.uint16LE();
  var capabilityUpper = reader.uint16LE();
  var capabilityFlags = ((capabilityUpper << 16) | capabilityLower) >>> 0;
  var authPluginDataLength = reader.uint8();
  reader.skip(10);

  var authPluginDataPart2 = Buffer.alloc(0);
  if (hasCapability(capabilityFlags, capabilities.SECURE_CONNECTION) && reader.remaining()) {
    var expectedPart2 = Math.max(13, authPluginDataLength - 8);
    var availablePart2 = Math.min(reader.remaining(), expectedPart2);
    authPluginDataPart2 = reader.bytes(availablePart2);
    if (authPluginDataPart2.length && authPluginDataPart2[authPluginDataPart2.length - 1] === 0) {
      authPluginDataPart2 = authPluginDataPart2.subarray(0, authPluginDataPart2.length - 1);
    }
  }

  var authPluginName = null;
  if (hasCapability(capabilityFlags, capabilities.PLUGIN_AUTH) && reader.remaining()) {
    var remaining = reader.bytes(reader.remaining());
    var nul = remaining.indexOf(0);
    if (nul !== -1) remaining = remaining.subarray(0, nul);
    authPluginName = remaining.toString('utf8') || null;
  }

  var authPluginData = Buffer.concat([authPluginDataPart1, authPluginDataPart2]);
  if (authPluginDataLength > 0 && authPluginData.length > authPluginDataLength - 1) {
    authPluginData = authPluginData.subarray(0, authPluginDataLength - 1);
  }

  return {
    protocolVersion: protocolVersion,
    serverVersion: serverVersion,
    connectionId: connectionId,
    capabilityFlags: capabilityFlags,
    characterSet: characterSet,
    statusFlags: statusFlags,
    authPluginDataLength: authPluginDataLength,
    authPluginData: authPluginData,
    authPluginName: authPluginName
  };
}

exports.parseHandshakeV10 = parseHandshakeV10;
