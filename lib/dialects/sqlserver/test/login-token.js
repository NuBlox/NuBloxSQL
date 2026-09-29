'use strict';

var assert = require('assert');
var login7 = require('../lib/Login7');
var tokens = require('../lib/TokenStream');
var tds = require('../lib/TdsPacket');

function pair(buffer, offset) {
  return { offset: buffer.readUInt16LE(offset), length: buffer.readUInt16LE(offset + 2) };
}

var login = login7.encode({
  hostName: 'DEVBOX',
  user: 'nublox',
  password: 'S3cret!',
  appName: 'NuBloxSQL',
  serverName: 'localhost',
  database: 'nublox_ci',
  packetSize: 4096,
  clientPid: 1234,
  clientId: Buffer.from([0, 1, 2, 3, 4, 5]),
  readOnlyIntent: true
});
assert.strictEqual(login.readUInt32LE(0), login.length);
assert.strictEqual(login.readUInt32LE(4), login7.TDS_74);
assert.strictEqual(login.readUInt32LE(8), 4096);
assert.strictEqual(login.readUInt32LE(16), 1234);
assert.strictEqual(login[26] & 0x20, 0x20);
assert.deepStrictEqual(login.subarray(72, 78), Buffer.from([0, 1, 2, 3, 4, 5]));

var host = pair(login, 36);
assert.strictEqual(host.offset, login7.FIXED_LENGTH);
assert.strictEqual(host.length, 6);
assert.strictEqual(login.toString('utf16le', host.offset, host.offset + host.length * 2), 'DEVBOX');
var user = pair(login, 40);
assert.strictEqual(login.toString('utf16le', user.offset, user.offset + user.length * 2), 'nublox');
var password = pair(login, 44);
assert.strictEqual(password.length, 7);
var clearPassword = login7.decodePasswordBytes(login.subarray(password.offset, password.offset + password.length * 2));
assert.strictEqual(clearPassword.toString('utf16le'), 'S3cret!');
assert.notDeepStrictEqual(login.subarray(password.offset, password.offset + password.length * 2), Buffer.from('S3cret!', 'utf16le'));
assert.throws(function () { login7.encode({ integratedSecurity: true }); }, /standard SQL authentication only/);
assert.throws(function () { login7.encode({ clientId: Buffer.alloc(5) }); }, /exactly 6 bytes/);
assert.throws(function () { login7.encode({ user: 'x'.repeat(129) }); }, /at most 128/);

var loginPacket = tds.encodePacket({ type: tds.PACKET_TYPES.LOGIN7, payload: login });
assert.strictEqual(tds.decodePacket(loginPacket).type, tds.PACKET_TYPES.LOGIN7);
assert.deepStrictEqual(tds.decodePacket(loginPacket).payload, login);

function variableToken(type, body) {
  var token = Buffer.allocUnsafe(3 + body.length);
  token[0] = type;
  token.writeUInt16LE(body.length, 1);
  body.copy(token, 3);
  return token;
}

function bVarchar(value) {
  var text = Buffer.from(value, 'utf16le');
  return Buffer.concat([Buffer.from([value.length]), text]);
}

function usVarchar(value) {
  var text = Buffer.from(value, 'utf16le');
  var length = Buffer.allocUnsafe(2);
  length.writeUInt16LE(value.length, 0);
  return Buffer.concat([length, text]);
}

function loginAck(program) {
  var version = Buffer.allocUnsafe(4);
  version.writeUInt32LE(login7.TDS_74, 0);
  return variableToken(tokens.TOKENS.LOGINACK, Buffer.concat([
    Buffer.from([1]), version, bVarchar(program), Buffer.from([17, 0, 0, 1])
  ]));
}

function messageToken(type, number, state, severity, message, server, procedure, line) {
  var prefix = Buffer.allocUnsafe(6);
  prefix.writeUInt32LE(number, 0);
  prefix[4] = state;
  prefix[5] = severity;
  var lineBytes = Buffer.allocUnsafe(4);
  lineBytes.writeUInt32LE(line, 0);
  return variableToken(type, Buffer.concat([prefix, usVarchar(message), bVarchar(server), bVarchar(procedure), lineBytes]));
}

function done(status, rowCount) {
  var value = Buffer.alloc(13);
  value[0] = tokens.TOKENS.DONE;
  value.writeUInt16LE(status, 1);
  value.writeUInt16LE(0, 3);
  value.writeBigUInt64LE(BigInt(rowCount || 0), 5);
  return value;
}

var ack = loginAck('SQL Server');
var info = messageToken(tokens.TOKENS.INFO, 5701, 2, 0, "Changed database context to 'nublox_ci'.", 'server', '', 1);
var packetSizeNew = Buffer.from('4096', 'utf16le');
var packetSizeOld = Buffer.from('8000', 'utf16le');
var envBody = Buffer.concat([Buffer.from([4, 4]), packetSizeNew, Buffer.from([4]), packetSizeOld]);
var env = variableToken(tokens.TOKENS.ENVCHANGE, envBody);
var complete = done(tokens.DONE_STATUS.COUNT, 0);
var success = tokens.parseLoginResponse(Buffer.concat([ack, info, env, complete]));
assert.strictEqual(success.success, true);
assert.strictEqual(success.loginAck.programName, 'SQL Server');
assert.strictEqual(success.loginAck.tdsVersion, login7.TDS_74);
assert.strictEqual(success.tokens[1].message, "Changed database context to 'nublox_ci'.");
assert.strictEqual(success.tokens[2].newValue, '4096');
assert.strictEqual(success.tokens[2].oldValue, '8000');
assert.strictEqual(success.done.hasRowCount, true);
assert.strictEqual(success.done.rowCount, 0n);

var error = messageToken(tokens.TOKENS.ERROR, 18456, 1, 14, "Login failed for user 'nublox'.", 'server', '', 1);
var failureDone = done(tokens.DONE_STATUS.ERROR, 0);
var failure = tokens.parseLoginResponse(Buffer.concat([error, failureDone]));
assert.strictEqual(failure.success, false);
assert.strictEqual(failure.errors.length, 1);
assert.strictEqual(failure.errors[0].number, 18456);
assert.strictEqual(failure.errors[0].severity, 14);
assert.strictEqual(failure.done.error, true);

assert.throws(function () { tokens.parseLoginResponse(Buffer.from([0x99])); }, /Unsupported SQL Server login-response token/);
assert.throws(function () { tokens.parseLoginResponse(Buffer.from([tokens.TOKENS.LOGINACK, 10, 0, 1])); }, /Incomplete SQL Server LOGINACK body/);

console.log('NuBloxSQL SQL Server LOGIN7/token foundation passed');
