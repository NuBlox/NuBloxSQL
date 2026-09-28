var Sequence           = require('./Sequence');
var Util               = require('util');
var Packets            = require('../packets');
var Auth               = require('../Auth');
var AuthPlugins        = require('../AuthPlugins');
var ClientConstants    = require('../constants/client');
var CredentialProvider = require('../../CredentialProvider');

module.exports = Handshake;
Util.inherits(Handshake, Sequence);
function Handshake(options, callback) {
  Sequence.call(this, options, callback);

  options = options || {};

  this._config                        = options.config;
  this._handshakeInitializationPacket = null;
  this._authPlugin                    = null;
  this._authPluginName                = null;
  this._serverCapabilities            = 0;
  this._credentialsResolved           = false;
  this._credentialsResolving          = false;
}

Handshake.prototype.determinePacket = function determinePacket(firstByte, parser) {
  if (firstByte === 0xff) {
    return Packets.ErrorPacket;
  }

  if (!this._handshakeInitializationPacket) {
    return Packets.HandshakeInitializationPacket;
  }

  if (firstByte === 0x01) {
    return Packets.AuthMoreDataPacket;
  }

  if (firstByte === 0xfe) {
    return (parser.packetLength() === 1)
      ? Packets.UseOldPasswordPacket
      : Packets.AuthSwitchRequestPacket;
  }

  return undefined;
};

Handshake.prototype['AuthSwitchRequestPacket'] = function (packet) {
  this._beginAuthPlugin(packet.authMethodName, packet.authMethodData, true);
};

Handshake.prototype['AuthMoreDataPacket'] = function (packet) {
  var self = this;

  if (!this._authPlugin) {
    this._authFailure(createProtocolError('Authentication continuation received without an active plugin.'));
    return;
  }

  try {
    this._resolveAuthResult(this._authPlugin.next(packet.data), function (data) {
      self._sendAuthResponse(data);
    });
  } catch (err) {
    this._authFailure(err);
  }
};

Handshake.prototype['HandshakeInitializationPacket'] = function(packet) {
  this._handshakeInitializationPacket = packet;
  this._config.protocol41 = packet.protocol41;

  var serverSSLSupport = packet.serverCapabilities1 & ClientConstants.CLIENT_SSL;
  var serverCapabilities = packet.serverCapabilities1
    | ((packet.serverCapabilities2 || 0) << 16);

  this._serverCapabilities = serverCapabilities;

  if (!(serverCapabilities & ClientConstants.CLIENT_PLUGIN_AUTH)) {
    this._config.clientFlags &= ~ClientConstants.CLIENT_PLUGIN_AUTH;
  }

  if (!(serverCapabilities & ClientConstants.CLIENT_QUERY_ATTRIBUTES)) {
    this._config.clientFlags &= ~ClientConstants.CLIENT_QUERY_ATTRIBUTES;
  }

  if (!(serverCapabilities & ClientConstants.CLIENT_SESSION_TRACK)) {
    this._config.clientFlags &= ~ClientConstants.CLIENT_SESSION_TRACK;
  }

  if (!this._negotiateCompression(serverCapabilities)) {
    return;
  }

  if (this._config.ssl) {
    if (!serverSSLSupport) {
      var err = new Error('Server does not support secure connection');

      err.code = 'HANDSHAKE_NO_SSL_SUPPORT';
      err.fatal = true;

      this.end(err);
      return;
    }

    this._config.clientFlags |= ClientConstants.CLIENT_SSL;
    this.emit('packet', new Packets.SSLRequestPacket({
      clientFlags   : this._config.clientFlags,
      maxPacketSize : this._config.maxPacketSize,
      charsetNumber : this._config.charsetNumber
    }));
    this.emit('start-tls');
  } else {
    this._sendCredentials();
  }
};

Handshake.prototype._tlsUpgradeCompleteHandler = function() {
  this._sendCredentials();
};

Handshake.prototype._sendCredentials = function() {
  var self = this;

  if (this._credentialsResolved) {
    this._sendResolvedCredentials();
    return;
  }

  if (this._credentialsResolving) {
    return;
  }

  var credentials;
  try {
    credentials = CredentialProvider.resolve(this._config);
  } catch (err) {
    this._authFailure(err);
    return;
  }

  if (credentials && typeof credentials.then === 'function') {
    this._credentialsResolving = true;
    credentials.then(function(resolved) {
      self._credentialsResolving = false;
      if (self._ended) {
        return;
      }

      CredentialProvider.apply(self._config, resolved);
      self._credentialsResolved = true;
      self._sendResolvedCredentials();
    }, function(err) {
      self._credentialsResolving = false;
      self._authFailure(err);
    });
    return;
  }

  CredentialProvider.apply(this._config, credentials);
  this._credentialsResolved = true;
  this._sendResolvedCredentials();
};

Handshake.prototype._sendResolvedCredentials = function() {
  var packet = this._handshakeInitializationPacket;
  var pluginName = (this._config.clientFlags & ClientConstants.CLIENT_PLUGIN_AUTH)
    ? (packet.pluginData || this._config.defaultAuthPlugin)
    : 'mysql_native_password';

  this._beginAuthPlugin(pluginName, packet.scrambleBuff(), false);
};

Handshake.prototype._beginAuthPlugin = function(name, data, switched) {
  var self = this;

  try {
    this._authPluginName = name;
    this._authPlugin = AuthPlugins.create(name, this._config);
    this._resolveAuthResult(this._authPlugin.initial(data), function (authData) {
      if (switched) {
        self._sendAuthResponse(authData);
        return;
      }

      var packet = self._handshakeInitializationPacket;
      self.emit('packet', new Packets.ClientAuthenticationPacket({
        clientFlags          : self._config.clientFlags,
        maxPacketSize        : self._config.maxPacketSize,
        charsetNumber        : self._config.charsetNumber,
        user                 : self._config.user,
        database             : self._config.database,
        protocol41           : packet.protocol41,
        scrambleBuff         : authData,
        zstdCompressionLevel : self._config.zstdCompressionLevel,
        authPluginName       : (self._config.clientFlags & ClientConstants.CLIENT_PLUGIN_AUTH)
          ? name
          : undefined
      }));
    });
  } catch (err) {
    this._authFailure(err);
  }
};

Handshake.prototype._resolveAuthResult = function(result, onValue) {
  var self = this;

  if (result && typeof result.then === 'function') {
    result.then(function (value) {
      if (!self._ended) {
        onValue(value);
      }
    }, function (err) {
      self._authFailure(err);
    });
    return;
  }

  onValue(result);
};

Handshake.prototype._sendAuthResponse = function(data) {
  if (data === null || data === undefined) {
    return;
  }

  this.emit('packet', new Packets.AuthSwitchResponsePacket({
    data: data
  }));
};

Handshake.prototype._authFailure = function(err) {
  if (!err || typeof err !== 'object') {
    err = new Error(String(err));
  }

  if (!err.code) {
    err.code = 'AUTH_PLUGIN_ERROR';
  }

  err.fatal = true;
  this.end(err);
};

Handshake.prototype['UseOldPasswordPacket'] = function() {
  if (!this._config.insecureAuth) {
    var err = new Error(
      'MySQL server is requesting the old and insecure pre-4.1 auth mechanism. ' +
      'Upgrade the user password or use the {insecureAuth: true} option.'
    );

    err.code = 'HANDSHAKE_INSECURE_AUTH';
    err.fatal = true;

    this.end(err);
    return;
  }

  this.emit('packet', new Packets.OldPasswordPacket({
    scrambleBuff: Auth.scramble323(this._handshakeInitializationPacket.scrambleBuff(), this._config.password)
  }));
};

Handshake.prototype['OkPacket'] = function(packet) {
  if (this._config.compressionAlgorithm === 'zstd') {
    this.emit('compression', {
      algorithm : 'zstd',
      level     : this._config.zstdCompressionLevel
    });
  } else if (this._config.compressionAlgorithm !== 'uncompressed') {
    this.emit('compression', this._config.compressionAlgorithm);
  }

  this.end(null, packet);
};

Handshake.prototype['ErrorPacket'] = function(packet) {
  var err = this._packetToError(packet, true);
  err.fatal = true;
  this.end(err);
};

Handshake.prototype._negotiateCompression = function(serverCapabilities) {
  var algorithms = this._config.compressionAlgorithms || ['uncompressed'];
  var serverSupportsZlib = Boolean(serverCapabilities & ClientConstants.CLIENT_COMPRESS);
  var serverSupportsZstd = Boolean(serverCapabilities & ClientConstants.CLIENT_ZSTD_COMPRESSION_ALGORITHM);

  for (var i = 0; i < algorithms.length; i++) {
    var algorithm = algorithms[i];

    if (algorithm === 'zlib' && serverSupportsZlib) {
      this._config.clientFlags |= ClientConstants.CLIENT_COMPRESS;
      this._config.clientFlags &= ~ClientConstants.CLIENT_ZSTD_COMPRESSION_ALGORITHM;
      this._config.compressionAlgorithm = 'zlib';
      return true;
    }

    if (algorithm === 'zstd' && serverSupportsZstd) {
      this._config.clientFlags &= ~ClientConstants.CLIENT_COMPRESS;
      this._config.clientFlags |= ClientConstants.CLIENT_ZSTD_COMPRESSION_ALGORITHM;
      this._config.compressionAlgorithm = 'zstd';
      return true;
    }

    if (algorithm === 'uncompressed') {
      this._config.clientFlags &= ~ClientConstants.CLIENT_COMPRESS;
      this._config.clientFlags &= ~ClientConstants.CLIENT_ZSTD_COMPRESSION_ALGORITHM;
      this._config.compressionAlgorithm = 'uncompressed';
      return true;
    }
  }

  this._config.clientFlags &= ~ClientConstants.CLIENT_COMPRESS;
  this._config.clientFlags &= ~ClientConstants.CLIENT_ZSTD_COMPRESSION_ALGORITHM;
  this._config.compressionAlgorithm = 'uncompressed';

  var err = new Error('No mutually supported MySQL connection compression algorithm');
  err.code = 'HANDSHAKE_NO_SUPPORTED_COMPRESSION';
  err.fatal = true;
  this.end(err);
  return false;
};

function createProtocolError(message) {
  var err = new Error(message);

  err.code = 'AUTH_PLUGIN_PROTOCOL_ERROR';
  err.fatal = true;

  return err;
}
