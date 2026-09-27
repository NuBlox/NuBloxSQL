// An experimental fake MySQL server for tricky integration tests. Expanded
// as needed.

var Buffer          = require('safe-buffer').Buffer;
var common          = require('./common');
var Charsets        = common.Charsets;
var ClientConstants = common.ClientConstants;
var Crypto          = require('crypto');
var Net             = require('net');
var tls             = require('tls');
var Packets         = common.Packets;
var PacketWriter    = common.PacketWriter;
var Parser          = common.Parser;
var Types           = common.Types;
var Errors          = common.Errors;
var EventEmitter    = require('events').EventEmitter;
var Util            = require('util');

module.exports = FakeServer;
Util.inherits(FakeServer, EventEmitter);
function FakeServer(options) {
  EventEmitter.call(this);

  this._connections = [];
  this._options     = options || {};
  this._server      = null;
}

FakeServer.prototype.listen = function(port, cb) {
  this._server = Net.createServer(this._handleConnection.bind(this));
  this._server.listen(port, cb);
};

FakeServer.prototype.port = function() {
  return this._server.address().port;
};

FakeServer.prototype._handleConnection = function(socket) {
  var connection = new FakeConnection(this, socket);

  if (!this.emit('connection', connection)) {
    connection.handshake();
  }

  this._connections.push(connection);
};

FakeServer.prototype.destroy = function() {
  if (this._server._handle) {
    // close server if listening
    this._server.close();
  }

  // destroy all connections
  this._connections.forEach(function(connection) {
    connection.destroy();
  });
};

Util.inherits(FakeConnection, EventEmitter);
function FakeConnection(server, socket) {
  EventEmitter.call(this);

  this.database = null;
  this.user     = null;

  this._cipher = null;
  this._server = server;
  this._socket = socket;
  this._stream = socket;
  this._parser = new Parser({onPacket: this._parsePacket.bind(this)});

  this._expectedNextPacket            = null;
  this._handshakeInitializationPacket = null;
  this._handshakeOptions              = {};

  socket.on('data', this._handleData.bind(this));
}

FakeConnection.prototype.authMoreData = function authMoreData(data, expectResponse) {
  this._sendPacket(new Packets.AuthMoreDataPacket({
    data           : data,
    expectResponse : expectResponse
  }));
};

FakeConnection.prototype.authSwitchRequest = function authSwitchRequest(options) {
  this._sendPacket(new Packets.AuthSwitchRequestPacket(options));
};

FakeConnection.prototype.deny = function deny(message, errno) {
  message = message || 'Access Denied';
  errno   = errno || Errors.ER_ACCESS_DENIED_ERROR;
  this.error(message, errno);
};

FakeConnection.prototype.error = function deny(message, errno) {
  this._sendPacket(new Packets.ErrorPacket({
    message : (message || 'Error'),
    errno   : (errno || Errors.ER_UNKNOWN_COM_ERROR)
  }));
  this._parser.resetPacketNumber();
};

FakeConnection.prototype.handshake = function(options) {
  this._handshakeOptions = options || {};

  var packetOptions = common.extend({
    scrambleBuff1       : Buffer.from('1020304050607080', 'hex'),
    scrambleBuff2       : Buffer.from('0102030405060708090A0B0C', 'hex'),
    serverCapabilities1 : 512, // only 1 flag, PROTOCOL_41
    protocol41          : true
  }, this._handshakeOptions);

  this._handshakeInitializationPacket = new Packets.HandshakeInitializationPacket(packetOptions);

  this._sendPacket(this._handshakeInitializationPacket);
};

FakeConnection.prototype.ok = function ok() {
  this._sendPacket(new Packets.OkPacket({
    protocol41: this._handshakeOptions.protocol41 !== false
  }));
  this._parser.resetPacketNumber();
};

FakeConnection.prototype._sendAuthResponse = function _sendAuthResponse(got, expected) {
  if (expected.toString('hex') === got.toString('hex')) {
    this.ok();
  } else {
    this.deny('expected ' + expected.toString('hex') + ' got ' + got.toString('hex'));
  }

  this._parser.resetPacketNumber();
};

FakeConnection.prototype._sendPacket = function(packet) {
  switch (packet.constructor) {
    case Packets.AuthMoreDataPacket:
      this._expectedNextPacket = packet.expectResponse
        ? Packets.AuthSwitchResponsePacket
        : null;
      break;
    case Packets.AuthSwitchRequestPacket:
      this._expectedNextPacket = Packets.AuthSwitchResponsePacket;
      break;
    case Packets.HandshakeInitializationPacket:
      this._expectedNextPacket = Packets.ClientAuthenticationPacket;
      break;
    case Packets.UseOldPasswordPacket:
      this._expectedNextPacket = Packets.OldPasswordPacket;
      break;
    default:
      this._expectedNextPacket = null;
      break;
  }

  var writer = new PacketWriter();
  packet.write(writer);
  this._stream.write(writer.toBuffer(this._parser));
};

FakeConnection.prototype._handleData = function(buffer) {
  this._parser.write(buffer);
};

FakeConnection.prototype._handleQueryPacket = function _handleQueryPacket(packet) {
  var conn = this;
  var match;
  var sql = packet.sql;

  if ((match = /^SELECT ([0-9]+);?$/i.exec(sql))) {
    var num = match[1];

    this._sendPacket(new Packets.ResultSetHeaderPacket({
      fieldCount: 1
    }));

    this._sendPacket(new Packets.FieldPacket({
      catalog    : 'def',
      charsetNr  : Charsets.UTF8_GENERAL_CI,
      default    : '0',
      name       : num,
      protocol41 : true,
      type       : Types.LONG
    }));

    this._sendPacket(new Packets.EofPacket());

    var writer = new PacketWriter();
    writer.writeLengthCodedString(num);
    this._socket.write(writer.toBuffer(this._parser));

    this._sendPacket(new Packets.EofPacket());
    this._parser.resetPacketNumber();
    return;
  }

  if ((match = /^SELECT CURRENT_USER\(\);?$/i.exec(sql))) {
    this._sendPacket(new Packets.ResultSetHeaderPacket({
      fieldCount: 2
    }));

    this._sendPacket(new Packets.FieldPacket({
      catalog    : 'def',
      charsetNr  : Charsets.UTF8_GENERAL_CI,
      name       : 'CURRENT_USER()',
      protocol41 : true,
      type       : Types.VARCHAR
    }));

    this._sendPacket(new Packets.EofPacket());

    var writer = new PacketWriter();
    writer.writeLengthCodedString((this.user || '') + '@localhost');
    this._socket.write(writer.toBuffer(this._parser));

    this._sendPacket(new Packets.EofPacket());
    this._parser.resetPacketNumber();
    return;
  }

  if ((match = /^SELECT SLEEP\(([0-9]+)\);?$/i.exec(sql))) {
    var sec = match[1];
    var time = sec * 1000;

    setTimeout(function () {
      conn._sendPacket(new Packets.ResultSetHeaderPacket({
        fieldCount: 1
      }));

      conn._sendPacket(new Packets.FieldPacket({
        catalog    : 'def',
        charsetNr  : Charsets.UTF8_GENERAL_CI,
        name       : 'SLEEP(' + sec + ')',
        protocol41 : true,
        type       : Types.LONG
      }));

      conn._sendPacket(new Packets.EofPacket());

      var writer = new PacketWriter();
      writer.writeLengthCodedString(0);
      conn._socket.write(writer.toBuffer(conn._parser));

      conn._sendPacket(new Packets.EofPacket());
      conn._parser.resetPacketNumber();
    }, time);
    return;
  }

  if ((match = /^SELECT \* FROM stream LIMIT ([0-9]+);?$/i.exec(sql))) {
    var num = match[1];

    this._writePacketStream(num);
    return;
  }

  if ((match = /^SHOW STATUS LIKE 'Ssl_cipher';?$/i.exec(sql))) {
    this._sendPacket(new Packets.ResultSetHeaderPacket({
      fieldCount: 2
    }));

    this._sendPacket(new Packets.FieldPacket({
      catalog    : 'def',
      charsetNr  : Charsets.UTF8_GENERAL_CI,
      name       : 'Variable_name',
      protocol41 : true,
      type       : Types.VARCHAR
    }));

    this._sendPacket(new Packets.FieldPacket({
      catalog    : 'def',
      charsetNr  : Charsets.UTF8_GENERAL_CI,
      name       : 'Value',
      protocol41 : true,
      type       : Types.VARCHAR
    }));

    this._sendPacket(new Packets.EofPacket());

    var writer = new PacketWriter();
    writer.writeLengthCodedString('Ssl_cipher');
    writer.writeLengthCodedString(this._stream.getCipher ? this._stream.getCipher().name : '');
    this._stream.write(writer.toBuffer(this._parser));

    this._sendPacket(new Packets.EofPacket());
    this._parser.resetPacketNumber();
    return;
  }

  this.error('Unknown query');
};

FakeConnection.prototype._handlePacket = function(packet) {
  if (packet instanceof Packets.ComQueryPacket) {
    this._handleQueryPacket(packet);
    return;
  }

  if (packet instanceof Packets.ComPingPacket) {
    this.ok();
    return;
  }

  if (packet instanceof Packets.ComQuitPacket) {
    this.destroy();
    return;
  }

  if (packet instanceof Packets.ComStatisticsPacket) {
    this._sendPacket(new Packets.StatisticsPacket({
      message: 'Uptime: 0'
    }));
    this._parser.resetPacketNumber();
    return;
  }

  this.error('Unknown command');
};

FakeConnection.prototype._handlePacketQuery = function(packet) {
  this._handleQueryPacket(packet);
};

FakeConnection.prototype._parsePacket = function(packetHeader) {
  var packet = this._expectedNextPacket;

  if (!packet) {
    switch (this._parser.peak()) {
      case 0x01:
        packet = Packets.ComQuitPacket;
        break;
      case 0x03:
        packet = Packets.ComQueryPacket;
        break;
      case 0x09:
        packet = Packets.ComStatisticsPacket;
        break;
      case 0x0e:
        packet = Packets.ComPingPacket;
        break;
      default:
        packet = Packets.ClientAuthenticationPacket;
        break;
    }
  }

  var packetInstance = new packet({
    protocol41          : true,
    serverCapabilities1 : this._handshakeInitializationPacket
      ? this._handshakeInitializationPacket.serverCapabilities1
      : 0,
    serverCapabilities2 : this._handshakeInitializationPacket
      ? this._handshakeInitializationPacket.serverCapabilities2
      : 0
  });

  packetInstance.parse(this._parser);

  if (packetInstance instanceof Packets.ClientAuthenticationPacket) {
    this.user = packetInstance.user;
    this.database = packetInstance.database;
    this.emit('auth', packetInstance);
    if (!this._handshakeOptions.noAutoAuth) {
      this.ok();
    }
    return;
  }

  this.emit('packet', packetInstance);
  this._handlePacket(packetInstance);
};

FakeConnection.prototype._writePacketStream = function(num) {
  this._sendPacket(new Packets.ResultSetHeaderPacket({
    fieldCount: 1
  }));

  this._sendPacket(new Packets.FieldPacket({
    catalog    : 'def',
    charsetNr  : Charsets.UTF8_GENERAL_CI,
    name       : 'value',
    protocol41 : true,
    type       : Types.LONG
  }));

  this._sendPacket(new Packets.EofPacket());

  for (var i = 0; i < num; i++) {
    var writer = new PacketWriter();
    writer.writeLengthCodedNumber(i);
    this._stream.write(writer.toBuffer(this._parser));
  }

  this._sendPacket(new Packets.EofPacket());
  this._parser.resetPacketNumber();
};

FakeConnection.prototype.destroy = function() {
  this._socket.destroy();
};

FakeConnection.prototype.end = function() {
  this._socket.end();
};

FakeConnection.prototype.pause = function() {
  this._socket.pause();
};

FakeConnection.prototype.resume = function() {
  this._socket.resume();
};

FakeConnection.prototype.ssl = function(callback) {
  var tlsOptions = common.extend({
    isServer : true,
    key      : this._handshakeOptions.key,
    cert     : this._handshakeOptions.cert
  }, this._handshakeOptions.tls || {});

  var tlsSocket = new tls.TLSSocket(this._socket, tlsOptions);

  this._stream = tlsSocket;
  tlsSocket.on('data', this._handleData.bind(this));
  callback();
};
