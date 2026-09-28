'use strict';

var Auth   = require('./Auth');
var Buffer = require('safe-buffer').Buffer;
var Crypto = require('crypto');

var CACHING_SHA2_FAST_AUTH_SUCCESS = 0x03;
var CACHING_SHA2_FULL_AUTH         = 0x04;

exports.create = createAuthPlugin;
exports.calculateCachingSha2Token = calculateCachingSha2Token;
exports.encryptPassword = encryptPassword;

function createAuthPlugin(name, config) {
  config = config || {};

  if (config.authPlugins && typeof config.authPlugins[name] === 'function') {
    return createCustomPlugin(name, config.authPlugins[name], config);
  }

  switch (name) {
    case 'mysql_native_password':
      return createNativePasswordPlugin(config);
    case 'caching_sha2_password':
      return createCachingSha2Plugin(config);
    case 'sha256_password':
      return createSha256Plugin(config);
    case 'mysql_clear_password':
      return createClearPasswordPlugin(config);
    default:
      throw createAuthError(
        'UNSUPPORTED_AUTH_METHOD',
        'MySQL is requesting the ' + name + ' authentication method, which is not supported.'
      );
  }
}

function createCustomPlugin(name, factory, config) {
  var handler = factory({
    config     : config,
    pluginName : name,
    secure     : isSecure(config)
  });
  var step = 0;

  if (typeof handler !== 'function') {
    throw createAuthError(
      'INVALID_AUTH_PLUGIN',
      'Authentication plugin factory for ' + name + ' must return a function.'
    );
  }

  return {
    name    : name,
    initial : function initial(data) {
      return handler(data, {
        phase      : 'initial',
        pluginName : name,
        secure     : isSecure(config),
        step       : step++
      });
    },
    next: function next(data) {
      return handler(data, {
        phase      : 'continue',
        pluginName : name,
        secure     : isSecure(config),
        step       : step++
      });
    }
  };
}

function createNativePasswordPlugin(config) {
  return {
    name    : 'mysql_native_password',
    initial : function initial(data) {
      return Auth.token(config.password, normalizeScramble(data));
    },
    next: function next() {
      throw createAuthError(
        'AUTH_PLUGIN_PROTOCOL_ERROR',
        'mysql_native_password received unexpected continuation data.'
      );
    }
  };
}

function createCachingSha2Plugin(config) {
  var scramble = null;
  var state = 'initial';

  return {
    name    : 'caching_sha2_password',
    initial : function initial(data) {
      scramble = normalizeScramble(data);
      state = 'token-sent';
      return calculateCachingSha2Token(config.password, scramble);
    },
    next: function next(data) {
      if (state === 'token-sent') {
        if (isSingleByte(data, CACHING_SHA2_FAST_AUTH_SUCCESS)) {
          state = 'complete';
          return null;
        }

        if (!isSingleByte(data, CACHING_SHA2_FULL_AUTH)) {
          throw createAuthError(
            'AUTH_PLUGIN_PROTOCOL_ERROR',
            'caching_sha2_password received an unexpected authentication continuation packet.'
          );
        }

        if (isSecure(config)) {
          state = 'complete';
          return clearPassword(config.password);
        }

        if (config.serverPublicKey) {
          state = 'complete';
          return encryptPassword(config.password, scramble, config.serverPublicKey);
        }

        if (!config.allowPublicKeyRetrieval) {
          throw createAuthError(
            'AUTH_PUBLIC_KEY_RETRIEVAL_DISABLED',
            'caching_sha2_password requires TLS, a configured serverPublicKey, or allowPublicKeyRetrieval: true.'
          );
        }

        state = 'waiting-public-key';
        return Buffer.from([0x02]);
      }

      if (state === 'waiting-public-key') {
        notifyServerPublicKey(config, data);
        state = 'complete';
        return encryptPassword(config.password, scramble, data);
      }

      throw createAuthError(
        'AUTH_PLUGIN_PROTOCOL_ERROR',
        'caching_sha2_password received data after authentication completed.'
      );
    }
  };
}

function createSha256Plugin(config) {
  var scramble = null;
  var state = 'initial';

  return {
    name    : 'sha256_password',
    initial : function initial(data) {
      scramble = normalizeScramble(data);

      if (isSecure(config)) {
        state = 'complete';
        return clearPassword(config.password);
      }

      if (config.serverPublicKey) {
        state = 'complete';
        return encryptPassword(config.password, scramble, config.serverPublicKey);
      }

      if (!config.allowPublicKeyRetrieval) {
        throw createAuthError(
          'AUTH_PUBLIC_KEY_RETRIEVAL_DISABLED',
          'sha256_password requires TLS, a configured serverPublicKey, or allowPublicKeyRetrieval: true.'
        );
      }

      state = 'waiting-public-key';
      return Buffer.from([0x01]);
    },
    next: function next(data) {
      if (state !== 'waiting-public-key') {
        throw createAuthError(
          'AUTH_PLUGIN_PROTOCOL_ERROR',
          'sha256_password received unexpected authentication continuation data.'
        );
      }

      notifyServerPublicKey(config, data);
      state = 'complete';
      return encryptPassword(config.password, scramble, data);
    }
  };
}

function createClearPasswordPlugin(config) {
  return {
    name    : 'mysql_clear_password',
    initial : function initial() {
      if (!isSecure(config)) {
        throw createAuthError(
          'AUTH_CLEAR_PASSWORD_INSECURE',
          'mysql_clear_password is only permitted over TLS or a local socket.'
        );
      }

      return clearPassword(config.password);
    },
    next: function next() {
      throw createAuthError(
        'AUTH_PLUGIN_PROTOCOL_ERROR',
        'mysql_clear_password received unexpected continuation data.'
      );
    }
  };
}

function calculateCachingSha2Token(password, scramble) {
  if (!password) {
    return Buffer.alloc(0);
  }

  var passwordHash = sha256(Buffer.from(password, 'utf8'));
  var doubleHash = sha256(passwordHash);
  var challengeHash = sha256(Buffer.concat([doubleHash, normalizeScramble(scramble)]));

  return xorBuffers(passwordHash, challengeHash);
}

function encryptPassword(password, scramble, publicKey) {
  var passwordBytes = clearPassword(password);
  var challenge = normalizeScramble(scramble);
  var mixed = Buffer.allocUnsafe(passwordBytes.length);

  for (var i = 0; i < passwordBytes.length; i++) {
    mixed[i] = passwordBytes[i] ^ challenge[i % challenge.length];
  }

  return Crypto.publicEncrypt({
    key      : normalizePublicKey(publicKey),
    oaepHash : 'sha1',
    padding  : Crypto.constants.RSA_PKCS1_OAEP_PADDING
  }, mixed);
}

function sha256(data) {
  return Crypto.createHash('sha256').update(data).digest();
}

function xorBuffers(left, right) {
  var result = Buffer.allocUnsafe(left.length);

  for (var i = 0; i < left.length; i++) {
    result[i] = left[i] ^ right[i];
  }

  return result;
}

function clearPassword(password) {
  return Buffer.from(String(password || '') + '\0', 'utf8');
}

function normalizeScramble(data) {
  var buffer = Buffer.isBuffer(data) ? data : Buffer.from(data || []);

  if (buffer.length < 20) {
    throw createAuthError(
      'AUTH_PLUGIN_PROTOCOL_ERROR',
      'Authentication plugin scramble must contain at least 20 bytes.'
    );
  }

  return buffer.slice(0, 20);
}

function normalizePublicKey(key) {
  if (!Buffer.isBuffer(key)) {
    return key;
  }

  if (key.length && key[key.length - 1] === 0x00) {
    return key.slice(0, key.length - 1);
  }

  return key;
}

function notifyServerPublicKey(config, key) {
  if (typeof config.onServerPublicKey === 'function') {
    config.onServerPublicKey(normalizePublicKey(key));
  }
}

function isSingleByte(data, value) {
  return data && data.length === 1 && data[0] === value;
}

function isSecure(config) {
  return Boolean(config.ssl || config.socketPath);
}

function createAuthError(code, message) {
  var err = new Error(message);

  err.code = code;
  err.fatal = true;

  return err;
}
