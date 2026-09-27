var urlParse        = require('url').parse;
var ClientConstants = require('./protocol/constants/client');
var Charsets        = require('./protocol/constants/charsets');
var TlsPolicy       = require('./TlsPolicy');
var Zlib            = require('zlib');
var SSLProfiles     = null;

var DEFAULT_MAX_BUFFERED_ROWS = 100000;
var DEFAULT_MAX_FIELD_SIZE = 64 * 1024 * 1024;
var DEFAULT_MAX_INBOUND_PACKET_SIZE = 64 * 1024 * 1024;
var DEFAULT_MAX_METADATA_SIZE = 8 * 1024 * 1024;
var DEFAULT_MAX_RESULT_SET_COLUMNS = 4096;
var DEFAULT_MAX_RESULT_SET_SIZE = 256 * 1024 * 1024;
var DEFAULT_MAX_ROW_SIZE = 64 * 1024 * 1024;

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
  this.credentialProvider      = normalizeCredentialProvider(options.credentialProvider);
  this.allowPublicKeyRetrieval = options.allowPublicKeyRetrieval === true;
  this.serverPublicKey         = options.serverPublicKey;
  this.onServerPublicKey       = options.onServerPublicKey;
  this.maxPreparedStatements   = normalizePreparedStatementLimit(options.maxPreparedStatements);
  this.maxInboundPacketSize    = normalizePositiveLimit(
    options.maxInboundPacketSize,
    DEFAULT_MAX_INBOUND_PACKET_SIZE,
    'maxInboundPacketSize'
  );
  this.maxFieldSize            = normalizePositiveLimit(
    options.maxFieldSize,
    DEFAULT_MAX_FIELD_SIZE,
    'maxFieldSize'
  );
  this.maxMetadataSize         = normalizePositiveLimit(
    options.maxMetadataSize,
    DEFAULT_MAX_METADATA_SIZE,
    'maxMetadataSize'
  );
  this.maxResultSetColumns     = normalizePositiveLimit(
    options.maxResultSetColumns,
    DEFAULT_MAX_RESULT_SET_COLUMNS,
    'maxResultSetColumns'
  );
  this.maxRowSize              = normalizePositiveLimit(
    options.maxRowSize,
    DEFAULT_MAX_ROW_SIZE,
    'maxRowSize'
  );
  this.maxBufferedRows         = normalizePositiveLimit(
    options.maxBufferedRows,
    DEFAULT_MAX_BUFFERED_ROWS,
    'maxBufferedRows'
  );
  this.maxResultSetSize        = normalizePositiveLimit(
    options.maxResultSetSize,
    DEFAULT_MAX_RESULT_SET_SIZE,
    'maxResultSetSize'
  );
  this.namedPlaceholders       = options.namedPlaceholders === true;
  this.compressionAlgorithms   = normalizeCompressionAlgorithms(options);
  this.zstdCompressionLevel    = normalizeZstdCompressionLevel(options.zstdCompressionLevel);
  this.compressionAlgorithm    = 'uncompressed';
  this.ssl                     = (typeof options.ssl === 'string')
    ? cloneObject(ConnectionConfig.getSSLProfile(options.ssl))
    : (options.ssl ? cloneObject(options.ssl) : false);

  var tlsPolicy = TlsPolicy.apply(this.ssl, options.tlsPolicy);
  this.tlsPolicy = tlsPolicy.name;
  this.ssl = tlsPolicy.ssl;

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

  var defaultFlags = ConnectionConfig.getDefaultFlags(this);
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
    throw new TypeError("Unknown charset '" + charset + "'");
  }

  return num;
};

ConnectionConfig.getDefaultFlags = function getDefaultFlags(options) {
  var algorithms = options && Array.isArray(options.compressionAlgorithms)
    ? options.compressionAlgorithms
    : [];
  var defaultFlags = [
    algorithms.indexOf('zlib') !== -1 ? '+COMPRESS' : '-COMPRESS',
    algorithms.indexOf('zstd') !== -1 ? '+ZSTD_COMPRESSION_ALGORITHM' : '-ZSTD_COMPRESSION_ALGORITHM',
    '-CONNECT_ATTRS',
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
    throw new TypeError("Unknown SSL profile '" + name + "'");
  }

  return ssl;
};

ConnectionConfig.parseFlagList = function(flagList) {
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

function cloneObject(value) {
  var clone = {};

  for (var key in value) {
    clone[key] = value[key];
  }

  return clone;
}

function normalizeCredentialProvider(value) {
  if (value === undefined || value === null || value === false) {
    return null;
  }

  if (typeof value !== 'function') {
    throw new TypeError('credentialProvider must be a function');
  }

  return value;
}

function normalizePreparedStatementLimit(value) {
  if (value === undefined) {
    return 256;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError('maxPreparedStatements must be a non-negative integer');
  }

  return value;
}

function normalizePositiveLimit(value, defaultValue, name) {
  if (value === undefined) {
    return defaultValue;
  }

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(name + ' must be a positive safe integer');
  }

  return value;
}

function normalizeCompressionAlgorithms(options) {
  var value = options.compressionAlgorithms;

  if (value === undefined && options.compress !== undefined) {
    value = options.compress === true
      ? ['zlib', 'uncompressed']
      : ['uncompressed'];
  }

  if (value === undefined || value === null || value === false) {
    return ['uncompressed'];
  }

  if (typeof value === 'string') {
    value = value.split(',');
  }

  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('compressionAlgorithms must be a non-empty string or array');
  }

  var normalized = [];
  for (var i = 0; i < value.length; i++) {
    var algorithm = String(value[i]).trim().toLowerCase();

    if (algorithm !== 'zlib' && algorithm !== 'zstd' && algorithm !== 'uncompressed') {
      throw new TypeError("Unknown compression algorithm '" + algorithm + "'");
    }

    if (algorithm === 'zstd' && !supportsZstd()) {
      var error = new TypeError('zstd compression requires a Node.js runtime with built-in zstd support');
      error.code = 'ZSTD_RUNTIME_UNAVAILABLE';
      throw error;
    }

    if (normalized.indexOf(algorithm) === -1) {
      normalized.push(algorithm);
    }
  }

  return normalized;
}

function normalizeZstdCompressionLevel(value) {
  if (value === undefined || value === null) {
    return 3;
  }

  if (!Number.isInteger(value) || value < 1 || value > 22) {
    throw new TypeError('zstdCompressionLevel must be an integer from 1 to 22');
  }

  return value;
}

function supportsZstd() {
  return typeof Zlib.zstdCompressSync === 'function' &&
    typeof Zlib.zstdDecompressSync === 'function' &&
    Zlib.constants &&
    Zlib.constants.ZSTD_c_compressionLevel !== undefined;
}
