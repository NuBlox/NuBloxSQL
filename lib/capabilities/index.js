'use strict';

var core = require('./Model');
var models = Object.freeze({
  postgresql: require('./tier1/postgresql'),
  mysql: require('./tier1/mysql'),
  sqlite: require('./tier1/sqlite')
});

function normalizeDialect(dialect) {
  if (typeof dialect !== 'string' || dialect.trim().length === 0) throw new TypeError('SQL capability model requires a dialect');
  var value = dialect.trim().toLowerCase();
  if (value === 'postgres' || value === 'pg') value = 'postgresql';
  if (!Object.prototype.hasOwnProperty.call(models, value)) throw new RangeError('SQL capability model currently supports Tier-1 dialects: postgresql, mysql, sqlite');
  return value;
}

function dialect(dialectName) {
  return models[normalizeDialect(dialectName)];
}

function get(dialectName, path) {
  return core.getPath(dialect(dialectName), path);
}

function supports(dialectName, path) {
  var value = get(dialectName, path);
  return core.isFeature(value) ? value.supported === true : false;
}

function status(dialectName, path) {
  var value = get(dialectName, path);
  return core.isFeature(value) ? value : null;
}

function compare(path, dialectNames) {
  var names = dialectNames === undefined ? core.TIER1_DIALECTS : dialectNames;
  if (!Array.isArray(names) || names.length === 0) throw new TypeError('SQL capability comparison requires at least one dialect');
  var result = {};
  var portable = true;
  var determinate = true;
  names.forEach(function (name) {
    var normalized = normalizeDialect(name);
    var entry = status(normalized, path);
    result[normalized] = entry;
    if (!entry || entry.supported !== true) portable = false;
    if (!entry || entry.supported === null) determinate = false;
  });
  return core.deepFreeze({
    path: path,
    dialects: result,
    portable: portable,
    determinate: determinate
  });
}

var api = Object.freeze({
  schemaVersion: core.SCHEMA_VERSION,
  tier1Dialects: core.TIER1_DIALECTS,
  categories: core.CATEGORIES,
  supportLevels: core.SUPPORT_LEVELS,
  dialect: dialect,
  get: get,
  status: status,
  supports: supports,
  compare: compare
});

exports.api = api;
exports.models = models;
exports.normalizeDialect = normalizeDialect;
