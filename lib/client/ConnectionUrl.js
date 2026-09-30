'use strict';

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

function decode(value, label) {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch (error) {
    throw new TypeError('Invalid percent-encoding in NuBloxSQL connection URL ' + label);
  }
}

function parseInteger(value, label) {
  if (value === null || value === '') return undefined;
  if (!/^\d+$/.test(value)) throw new TypeError('NuBloxSQL connection URL ' + label + ' must be an integer');
  var number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new RangeError('NuBloxSQL connection URL ' + label + ' is outside the supported range');
  return number;
}

function parseBoolean(value, label) {
  if (value === null) return undefined;
  var normalized = String(value).trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
  throw new TypeError('NuBloxSQL connection URL ' + label + ' must be a boolean');
}

function databaseFromPath(url) {
  if (!url.pathname || url.pathname === '/') return undefined;
  return decode(url.pathname.replace(/^\//, ''), 'database');
}

function parseNetworkUrl(url, dialect) {
  if (!url.hostname) throw new TypeError('NuBloxSQL ' + dialect + ' connection URL requires a host');

  var config = { host: url.hostname };
  if (url.port) config.port = parseInteger(url.port, 'port');
  if (url.username) config.user = decode(url.username, 'username');
  if (url.password) config.password = decode(url.password, 'password');

  var database = databaseFromPath(url);
  if (database !== undefined) config.database = database;

  var connectTimeout = url.searchParams.get('connectTimeout');
  if (connectTimeout !== null) config.connectTimeout = parseInteger(connectTimeout, 'connectTimeout');

  if (dialect === 'postgresql') {
    var applicationName = url.searchParams.get('applicationName') || url.searchParams.get('application_name');
    if (applicationName !== null) config.applicationName = applicationName;
    var sslmode = url.searchParams.get('sslmode');
    if (sslmode !== null) {
      var mode = sslmode.toLowerCase();
      if (mode === 'disable') config.ssl = false;
      else if (mode === 'prefer' || mode === 'require') config.ssl = mode;
      else throw new RangeError('Unsupported PostgreSQL sslmode in NuBloxSQL connection URL: ' + sslmode);
    }
  }

  if (dialect === 'mysql') {
    var ssl = url.searchParams.get('ssl');
    if (ssl !== null) config.ssl = parseBoolean(ssl, 'ssl');
  }

  if (dialect === 'sqlserver') {
    var rejectUnauthorized = url.searchParams.get('rejectUnauthorized');
    if (rejectUnauthorized !== null) config.rejectUnauthorized = parseBoolean(rejectUnauthorized, 'rejectUnauthorized');
    var queryTimeout = url.searchParams.get('queryTimeout');
    if (queryTimeout !== null) config.queryTimeout = parseInteger(queryTimeout, 'queryTimeout');
  }

  return config;
}

function parseSqliteUrl(value, url) {
  var raw = typeof value === 'string' ? value.trim() : url.href;
  if (/^sqlite::memory:$/i.test(raw) || /^sqlite:\/\/:memory:$/i.test(raw)) return { filename: ':memory:' };

  if (url.username || url.password || url.port) {
    throw new TypeError('SQLite connection URLs do not support credentials or ports');
  }

  if (url.hostname && url.hostname !== 'localhost') {
    throw new TypeError('SQLite connection URL host must be empty or localhost');
  }

  if (!url.pathname || url.pathname === '/') {
    throw new TypeError('SQLite connection URL requires a database filename or :memory:');
  }

  var filename = decode(url.pathname, 'filename');
  if (url.hostname === 'localhost' && filename.charAt(0) !== '/') filename = '/' + filename;
  return { filename: filename };
}

function parse(value) {
  if (!isUrlLike(value)) throw new TypeError('NuBloxSQL connection URL must be a URL or URL-like string');

  var url;
  try {
    url = value instanceof URL ? value : new URL(value.trim());
  } catch (error) {
    throw new TypeError('Invalid NuBloxSQL connection URL');
  }

  var dialect = SCHEMES[url.protocol.toLowerCase()];
  if (!dialect) throw new RangeError('Unsupported NuBloxSQL connection URL scheme: ' + url.protocol.replace(/:$/, ''));

  return {
    dialect: dialect,
    config: dialect === 'sqlite' ? parseSqliteUrl(value, url) : parseNetworkUrl(url, dialect)
  };
}

exports.SCHEMES = SCHEMES;
exports.isUrlLike = isUrlLike;
exports.parse = parse;
