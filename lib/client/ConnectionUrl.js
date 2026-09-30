'use strict';

var publicError = require('./PublicError');

var SCHEMES = Object.freeze({
  'mysql:': 'mysql',
  'mysql2:': 'mysql',
  'postgres:': 'postgresql',
  'postgresql:': 'postgresql',
  'mssql:': 'sqlserver',
  'sqlserver:': 'sqlserver',
  'sqlite:': 'sqlite'
});

function isUrlLike(value) {
  if (value instanceof URL) return true;
  if (typeof value !== 'string') return false;
  var trimmed = value.trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || /^sqlite:/i.test(trimmed);
}

function routing(message, dialect, cause) {
  return publicError.routingError(message, { dialect: dialect || null, cause: cause });
}

function decode(value, label, dialect) {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch (error) {
    throw routing('Invalid percent-encoding in NuBloxSQL connection URL ' + label, dialect, error);
  }
}

function parseInteger(value, label, dialect) {
  if (value === null || value === '') return undefined;
  if (!/^\d+$/.test(value)) throw routing('NuBloxSQL connection URL ' + label + ' must be an integer', dialect);
  var number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw routing('NuBloxSQL connection URL ' + label + ' is outside the supported range', dialect);
  return number;
}

function parseBoolean(value, label, dialect) {
  if (value === null) return undefined;
  var normalized = String(value).trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
  throw routing('NuBloxSQL connection URL ' + label + ' must be a boolean', dialect);
}

function databaseFromPath(url, dialect) {
  if (!url.pathname || url.pathname === '/') return undefined;
  return decode(url.pathname.replace(/^\//, ''), 'database', dialect);
}

function parseNetworkUrl(url, dialect) {
  if (!url.hostname) throw routing('NuBloxSQL ' + dialect + ' connection URL requires a host', dialect);

  var config = { host: url.hostname };
  if (url.port) config.port = parseInteger(url.port, 'port', dialect);
  if (url.username) config.user = decode(url.username, 'username', dialect);
  if (url.password) config.password = decode(url.password, 'password', dialect);

  var database = databaseFromPath(url, dialect);
  if (database !== undefined) config.database = database;

  var connectTimeout = url.searchParams.get('connectTimeout');
  if (connectTimeout !== null) config.connectTimeout = parseInteger(connectTimeout, 'connectTimeout', dialect);

  if (dialect === 'postgresql') {
    var applicationName = url.searchParams.get('applicationName') || url.searchParams.get('application_name');
    if (applicationName !== null) config.applicationName = applicationName;
    var sslmode = url.searchParams.get('sslmode');
    if (sslmode !== null) {
      var mode = sslmode.toLowerCase();
      if (mode === 'disable') config.ssl = false;
      else if (mode === 'prefer' || mode === 'require') config.ssl = mode;
      else throw routing('Unsupported PostgreSQL sslmode in NuBloxSQL connection URL: ' + sslmode, dialect);
    }
  }

  if (dialect === 'mysql') {
    var ssl = url.searchParams.get('ssl');
    if (ssl !== null) config.ssl = parseBoolean(ssl, 'ssl', dialect);
  }

  if (dialect === 'sqlserver') {
    var rejectUnauthorized = url.searchParams.get('rejectUnauthorized');
    if (rejectUnauthorized !== null) config.rejectUnauthorized = parseBoolean(rejectUnauthorized, 'rejectUnauthorized', dialect);
    var queryTimeout = url.searchParams.get('queryTimeout');
    if (queryTimeout !== null) config.queryTimeout = parseInteger(queryTimeout, 'queryTimeout', dialect);
  }

  return config;
}

function parseSqliteUrl(value, url) {
  var raw = typeof value === 'string' ? value.trim() : url.href;
  if (/^sqlite::memory:$/i.test(raw) || /^sqlite:\/\/:memory:$/i.test(raw)) return { filename: ':memory:' };

  if (url.username || url.password || url.port) throw routing('SQLite connection URLs do not support credentials or ports', 'sqlite');
  if (url.hostname && url.hostname !== 'localhost') throw routing('SQLite connection URL host must be empty or localhost', 'sqlite');
  if (!url.pathname || url.pathname === '/') throw routing('SQLite connection URL requires a database filename or :memory:', 'sqlite');

  var filename = decode(url.pathname, 'filename', 'sqlite');
  if (url.hostname === 'localhost' && filename.charAt(0) !== '/') filename = '/' + filename;
  return { filename: filename };
}

function parse(value) {
  if (!isUrlLike(value)) throw routing('NuBloxSQL connection URL must be a URL or URL-like string');

  var url;
  try {
    url = value instanceof URL ? value : new URL(value.trim());
  } catch (error) {
    throw routing('Invalid NuBloxSQL connection URL', null, error);
  }

  var dialect = SCHEMES[url.protocol.toLowerCase()];
  if (!dialect) throw publicError.unsupportedUrlSchemeError(url.protocol.replace(/:$/, ''));

  return {
    dialect: dialect,
    config: dialect === 'sqlite' ? parseSqliteUrl(value, url) : parseNetworkUrl(url, dialect)
  };
}

exports.SCHEMES = SCHEMES;
exports.isUrlLike = isUrlLike;
exports.parse = parse;
