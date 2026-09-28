'use strict';

var assert = require('assert');
var path = require('path');
var Buffer = require('safe-buffer').Buffer;

var ClientConstants = require(path.resolve(__dirname, '../../../lib/protocol/constants/client'));
var ConnectionConfig = require(path.resolve(__dirname, '../../../lib/ConnectionConfig'));
var Handshake = require(path.resolve(__dirname, '../../../lib/protocol/sequences/Handshake'));
var OkPacket = require(path.resolve(__dirname, '../../../lib/protocol/packets/OkPacket'));
var Parser = require(path.resolve(__dirname, '../../../lib/protocol/Parser'));
var ServerStatus = require(path.resolve(__dirname, '../../../lib/protocol/constants/server_status'));
var SessionState = require(path.resolve(__dirname, '../../../lib/protocol/SessionState'));

var SESSION_TRACK = ClientConstants.CLIENT_SESSION_TRACK;

var defaults = new ConnectionConfig({});
assert.ok(defaults.clientFlags & SESSION_TRACK, 'CLIENT_SESSION_TRACK should be requested by default');

var disabled = new ConnectionConfig({flags: '-SESSION_TRACK'});
assert.strictEqual(disabled.clientFlags & SESSION_TRACK, 0);

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
assert.strictEqual(unsupportedConfig.clientFlags & SESSION_TRACK, 0);

var supportedConfig = new ConnectionConfig({});
var supported = new Handshake({config: supportedConfig});
supported._negotiateCompression = function negotiateCompression() {
  return true;
};
supported._sendCredentials = function sendCredentials() {};
supported.HandshakeInitializationPacket({
  protocol41          : true,
  serverCapabilities1 : ClientConstants.CLIENT_PROTOCOL_41,
  serverCapabilities2 : (ClientConstants.CLIENT_PLUGIN_AUTH | SESSION_TRACK) >>> 16
});
assert.ok(supportedConfig.clientFlags & SESSION_TRACK);

var statePayload = Buffer.concat([
  stateBlock(0, Buffer.concat([lenencString('autocommit'), lenencString('OFF')])),
  stateBlock(1, lenencString('nublox_ci')),
  stateBlock(2, lenencString('1')),
  stateBlock(3, Buffer.concat([Buffer.from([0]), lenencString('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:1')])),
  stateBlock(4, lenencString('START TRANSACTION READ ONLY;')),
  stateBlock(5, lenencString('T_______')),
  stateBlock(99, Buffer.from([0xde, 0xad]))
]);

var ok = parseOkPacket(
  Buffer.concat([
    Buffer.from([
      0x00,
      0x00,
      0x00,
      (ServerStatus.SERVER_STATUS_AUTOCOMMIT | ServerStatus.SERVER_SESSION_STATE_CHANGED) & 0xff,
      ((ServerStatus.SERVER_STATUS_AUTOCOMMIT | ServerStatus.SERVER_SESSION_STATE_CHANGED) >>> 8) & 0xff,
      0x00,
      0x00
    ]),
    lenencString(''),
    lenencBuffer(statePayload)
  ]),
  SESSION_TRACK
);

assert.strictEqual(ok.message, '');
assert.strictEqual(ok.sessionStateChanges.length, 7);
assert.deepStrictEqual(ok.sessionStateChanges[0].values, ['autocommit', 'OFF']);
assert.strictEqual(ok.sessionStateChanges[0].variable, 'autocommit');
assert.strictEqual(ok.sessionStateChanges[0].value, 'OFF');
assert.deepStrictEqual(ok.sessionStateChanges[1].values, ['nublox_ci']);
assert.strictEqual(ok.sessionStateChanges[1].name, 'schema');
assert.deepStrictEqual(ok.sessionStateChanges[2].values, ['1']);
assert.strictEqual(ok.sessionStateChanges[3].encoding, 0);
assert.strictEqual(ok.sessionStateChanges[3].value, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:1');
assert.strictEqual(ok.sessionStateChanges[4].name, 'transaction_characteristics');
assert.strictEqual(ok.sessionStateChanges[5].name, 'transaction_state');
assert.strictEqual(ok.sessionStateChanges[6].name, 'unknown');
assert.deepStrictEqual(Array.from(ok.sessionStateChanges[6].data), [0xde, 0xad]);

var parsedDirectly = SessionState.parse(statePayload);
assert.strictEqual(parsedDirectly.length, 7);

var legacyMessage = 'Rows matched: 1  Changed: 1  Warnings: 0';
var legacy = parseOkPacket(Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]),
  Buffer.from(legacyMessage)
]), 0);
assert.strictEqual(legacy.message, legacyMessage);
assert.strictEqual(legacy.changedRows, 1);
assert.deepStrictEqual(legacy.sessionStateChanges, []);

assert.throws(function rejectsMalformedSessionState() {
  SessionState.parse(Buffer.from([1, 4, 3, 0x61]));
}, function verify(error) {
  return error && error.code === 'PARSER_SESSION_STATE_INVALID' && error.fatal === true;
});

function parseOkPacket(body, clientFlags) {
  var result;
  var parser = new Parser({
    config   : {supportBigNumbers: true},
    onError  : function onError(error) {
      throw error;
    },
    onPacket : function onPacket() {
      result = new OkPacket({
        clientFlags : clientFlags,
        protocol41  : true
      });
      result.parse(parser);
    }
  });

  var wire = Buffer.alloc(4 + body.length);
  wire[0] = body.length & 0xff;
  wire[1] = (body.length >>> 8) & 0xff;
  wire[2] = (body.length >>> 16) & 0xff;
  wire[3] = 0;
  body.copy(wire, 4);
  parser.write(wire);

  return result;
}

function stateBlock(type, data) {
  return Buffer.concat([Buffer.from([type]), lenencBuffer(data)]);
}

function lenencString(value) {
  return lenencBuffer(Buffer.from(value, 'utf8'));
}

function lenencBuffer(value) {
  if (value.length <= 250) {
    return Buffer.concat([Buffer.from([value.length]), value]);
  }

  throw new Error('test helper only supports values up to 250 bytes');
}
