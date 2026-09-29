'use strict';

var assert = require('assert');
var EventEmitter = require('events');
var Connection = require('../lib/Connection').Connection;
var TdsPacket = require('../lib/TdsPacket');
var Prelogin = require('../lib/Prelogin');
var Login7 = require('../lib/Login7');
var TokenStream = require('../lib/TokenStream');

function variableToken(type, body) {
  var token = Buffer.allocUnsafe(3 + body.length);
  token[0] = type;
  token.writeUInt16LE(body.length, 1);
  body.copy(token, 3);
  return token;
}
function bVarchar(value) { return Buffer.concat([Buffer.from([value.length]), Buffer.from(value, 'utf16le')]); }
function loginAck() {
  var version = Buffer.allocUnsafe(4); version.writeUInt32LE(Login7.TDS_74, 0);
  return variableToken(TokenStream.TOKENS.LOGINACK, Buffer.concat([Buffer.from([1]), version, bVarchar('SQL Server'), Buffer.from([17, 0, 0, 1])]));
}
function envPacketSize(size) {
  var value = String(size);
  var body = Buffer.concat([Buffer.from([4, value.length]), Buffer.from(value, 'utf16le'), Buffer.from([0])]);
  return variableToken(TokenStream.TOKENS.ENVCHANGE, body);
}
function done() {
  var value = Buffer.alloc(13); value[0] = TokenStream.TOKENS.DONE; return value;
}

function FakeSocket(options) {
  EventEmitter.call(this);
  this.options = options;
  this.alpnProtocol = 'tds/8.0';
  this.destroyed = false;
  this.writes = [];
  this.stage = 0;
}
FakeSocket.prototype = Object.create(EventEmitter.prototype);
FakeSocket.prototype.constructor = FakeSocket;
FakeSocket.prototype.write = function write(chunk) {
  this.writes.push(Buffer.from(chunk));
  var packet = TdsPacket.decodePacket(chunk);
  var self = this;
  if (this.stage === 0) {
    assert.strictEqual(packet.type, TdsPacket.PACKET_TYPES.PRELOGIN);
    var request = Prelogin.decode(packet.payload);
    assert.strictEqual(request.encryption, Prelogin.ENCRYPTION.ON);
    this.stage += 1;
    var response = TdsPacket.encodePacket({
      type: TdsPacket.PACKET_TYPES.RESPONSE,
      payload: Prelogin.encode({ version:{major:16,minor:0,build:1000,subbuild:0}, encryption:Prelogin.ENCRYPTION.ON, threadId:0, mars:false })
    });
    process.nextTick(function () {
      self.emit('data', response.subarray(0, 11));
      self.emit('data', response.subarray(11));
    });
  } else if (this.stage === 1) {
    assert.strictEqual(packet.type, TdsPacket.PACKET_TYPES.LOGIN7);
    assert.ok(packet.payload.length >= Login7.FIXED_LENGTH);
    this.stage += 1;
    var loginResponse = TdsPacket.encodePacket({
      type: TdsPacket.PACKET_TYPES.RESPONSE,
      payload: Buffer.concat([loginAck(), envPacketSize(8192), done()])
    });
    process.nextTick(function () { self.emit('data', loginResponse); });
  }
  return true;
};
FakeSocket.prototype.end = function end() {
  var self = this;
  process.nextTick(function () { self.destroyed = true; self.emit('close'); });
};
FakeSocket.prototype.destroy = function destroy() {
  if (this.destroyed) return;
  this.destroyed = true;
  this.emit('close');
};

async function main() {
  var fake;
  function tlsConnect(options) {
    fake = new FakeSocket(options);
    process.nextTick(function () { fake.emit('secureConnect'); });
    return fake;
  }
  var connection = new Connection({
    host:'sql.example.test', user:'nublox', password:'secret', database:'nublox_ci',
    rejectUnauthorized:true, connectTimeout:1000
  }, { tlsConnect:tlsConnect });
  await connection.connect();
  assert.strictEqual(connection.connected, true);
  assert.strictEqual(connection.packetSize, 8192);
  assert.strictEqual(connection.loginResponse.success, true);
  assert.strictEqual(connection.loginResponse.loginAck.programName, 'SQL Server');
  assert.strictEqual(fake.options.servername, 'sql.example.test');
  assert.deepStrictEqual(fake.options.ALPNProtocols, ['tds/8.0']);
  assert.strictEqual(fake.writes.length, 2);
  await connection.end();
  assert.strictEqual(connection.ended, true);

  function wrongAlpn(options) {
    var socket = new FakeSocket(options);
    socket.alpnProtocol = 'http/1.1';
    process.nextTick(function () { socket.emit('secureConnect'); });
    return socket;
  }
  var rejected = new Connection({ host:'sql.example.test', user:'u', password:'p', connectTimeout:1000 }, { tlsConnect:wrongAlpn });
  await assert.rejects(function () { return rejected.connect(); }, /did not negotiate TDS 8.0/);

  console.log('NuBloxSQL SQL Server TDS 8 connection state machine passed');
}
main().catch(function (error) { console.error(error.stack || error); process.exitCode = 1; });
