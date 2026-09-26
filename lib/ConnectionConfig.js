var urlParse        = require('url').parse;
var ClientConstants = require('./protocol/constants/client');
var Charsets        = require('./protocol/constants/charsets');
var SSLProfiles     = null;

module.exports = ConnectionConfig;
function ConnectionConfig(options) {
  if (typeof options === 'string') {
    options = ConnectionConfig.parseUrl(options);
  }

  options = options || {};

  this.host                    = options.host || 'localhost';
  this.port                    = options.port || 3306;
  this.localAddress            = options.localAddress;
  this.socketPath              = options.socketPath;
  this.user                    = options.user || undefined;
  this.password                = options.password || undefined;
  this.database                = options.database;
  this.connectTimeout          = (options.connectTimeout === undefined)
    ? (10 * 1000)
    : options.connectTimeout;
  this.insecureAuth            = options.insecureAuth || false;
  this.supportBigNumbers       = options.supportBigNumbers || false;
  this.bigNumberStrings        = options.bigNumberStrings || false;
  this.dateStrings             = options.dateStrings || false;
  this.debug                   = options.debug;
  this.trace                   = options.trace !== false;
  this.stringifyObjects        = options.stringifyObjects || false;
  this.timezone                = options.timezone || 'local';
  this.flags                   = options.flags || '';
  this.queryFormat             = options.queryFormat;
  this.pool                    = options.pool || undefined;
  this.authPlugins             = options.authPlugins || Object.create(null);
  this.defaultAuthPlugin       = options.defaultAuthPlugin || 'mysql_native_password';
  this.allowPublicKeyRetrieval = options.allowPublicKeyRetrieval === true;
  this.serverPublicKey         = options.serverPublicKey;
  this.onServerPublicKey       = options.onServerPublicKey;
  this.ssl                     = (typeof options.ssl === 'string')
    ? ConnectionConfig.getSSLProfile(options.ssl)
    : (options.ssl || false);
  this.localInfile             = (options.localInfile === undefined)
    ? true
    : options.localInfile;
  this.multipleStatements      = options.multipleStatements || false;
  this.typeCast                = (options.typeCast === undefined)
    ? true
    : options.typeCast;

  if (this.timezone[0] === ' ') {
    this.timezone = '+' + this.timezone.substr(1);
  }

  if (this.ssl) {
    this.ssl.rejectUnauthorized = this.ssl.rejectUnauthorized !== false;
  }

  this.maxPacketSize = 0;
  this.charsetNumber = (options.charset)
    ? ConnectionConfig.getCharsetNumber(options.charset)
    : options.charsetNumber || Charsets.UTF8_GENERAL_CI;

  var defaultFlags = ConnectionConfig.getDefaultFlags(options);
  this.clientFlags = ConnectionConfig.mergeFlags(defaultFlags, options.flags);
}

ConnectionConfig.mergeFlags = function mergeFlags(defaultFlags, userFlags) {
  var allFlags = ConnectionConfig.parseFlagList(defaultFlags);
  var newFlags = ConnectionConfig.parseFlagList(userFlags);

  for (var flag in newFlags) {
    if (allFlags[flag] !== false) {
      allFlags[flag] = newFlags[flag];
    }
  }

  var flags = 0x0;
  for (var flag in allFlags) {
    if (allFlags[flag]) {
      flags |= ClientConstants['CLIENT_' + flag] || 0x0;
    }
  }

  return flags;
};

ConnectionConfig.getCharsetNumber = function getCharsetNumber(charset) {
  var num = Charsets[charset.toUpperCase()];

  if (num === undefined) {
    throw new TypeError('Unknown charset \'' + charset + '\'');
  }

  return num;
};

ConnectionConfig.getDefaultFlags = function getDefaultFlags(options) {
  var defaultFlags = [
    '-COMPRESS',          // Compression protocol is implemented in a later milestone.
    '-CONNECT_ATTRS',     // Connection attributes are implemented in a later milestone.
    '+CONNECT_WITH_DB',
    '+FOUND_ROWS',
    '+IGNORE_SIGPIPE',
    '+IGNORE_SPACE',
    '+LOCAL_FILES',
    '+LONG_FLAG',
    '+LONG_PASSWORD',
    '+MULTI_RESULTS',
    '+ODBC',
    '+PLUGIN_AUTH',
    '+PROTOCOL_41',
    '+PS_MULTI_RESULTS',
    '+RESERVED',
    '+SECURE_CONNECTION',
    '+TRANSACTIONS'
  ];

  if (options && options.localInfile !== undefined && !options.localInfile) {
    defaultFlags.push('-LOCAL_FILES');
  }

  if (options && options.multipleStatements) {
    defaultFlags.push('+MULTI_STATEMENTS');
  }

  return defaultFlags;
};

ConnectionConfig.getSSLProfile = function getSSLProfile(name) {
  if (!SSLProfiles) {
    SSLProfiles = require('./protocol/constants/ssl_profiles');
  }

  var ssl = SSLProfiles[name];

  if (ssl === undefined) {
    throw new TypeError('Unknown SSL profile \'' + name + '\'');
  }

  return ssl;
};

ConnectionConfig.parseFlagList = function parseFlagList(flagList) {
  var allFlags = Object.create(null);

  if (!flagList) {
    return allFlags;
  }

  var flags = !Array.isArray(flagList)
    ? String(flagList || '').toUpperCase().split(/\s*,+\s*/)
    : flagList;

  for (var i = 0; i < flags.length; i++) {
    var flag   = flags[i];
    var offset = 1;
    var state  = flag[0];

    if (state === undefined) {
      continue;
    }

    if (state !== '-' && state !== '+') {
      offset = 0;
      state  = '+';
    }

    allFlags[flag.substr(offset)] = state === '+';
  }

  return allFlags;
};

ConnectionConfig.parseUrl = function(url) {
  url = urlParse(url, true);

  var options = {
    host     : url.hostname,
    port     : url.port,
    database : url.pathname.substr(1)
  };

  if (url.auth) {
    var auth = url.auth.split(':');
    options.user     = auth.shift();
    options.password = auth.join(':');
  }

  if (url.query) {
    for (var key in url.query) {
      var value = url.query[key];

      try {
        options[key] = JSON.parse(value);
      } catch (err) {
        options[key] = value;
      }
    }
  }

  return options;
};
