'use strict';

var sqlApi = require('./Sql');

var PLAN_SCHEMA_VERSION = 1;
var STRATEGIES = Object.freeze([
  'postgresql-copy-csv',
  'mysql-local-infile-tsv',
  'sqlite-batched-insert',
  'sqlserver-batched-insert',
  'portable-batched-insert'
]);
var PREFERENCES = Object.freeze(['auto', 'native', 'portable']);
var MYSQL_FILENAME = 'nubloxsql-data-movement.tsv';

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.keys(value).forEach(function (key) { freeze(value[key]); });
  return Object.freeze(value);
}

function preference(options) {
  var value = options && options.strategy === undefined ? 'auto' : String(options && options.strategy || 'auto').toLowerCase();
  if (PREFERENCES.indexOf(value) === -1) {
    throw new RangeError('NuBloxSQL data movement strategy must be auto, native, or portable');
  }
  return value;
}

function nativeTarget(client) {
  if (!client) return null;
  try { return client.native || null; } catch (_) { return null; }
}

function hasNativeMethod(client, name) {
  var target = nativeTarget(client);
  return !!(target && typeof target[name] === 'function');
}

function plan(sourceClient, targetClient, spec, options) {
  void spec;
  var requested = preference(options || {});
  var dialect = targetClient && targetClient.dialect || null;
  var selected = 'portable-batched-insert';
  var accelerated = false;
  var reason = 'portable batched INSERT is available for every supported target client';

  if (requested !== 'portable' && dialect === 'postgresql' && hasNativeMethod(targetClient, 'copyFrom')) {
    selected = 'postgresql-copy-csv';
    accelerated = true;
    reason = 'target exposes the qualified PostgreSQL COPY FROM STDIN runtime';
  } else if (
    requested !== 'portable' &&
    dialect === 'mysql' &&
    targetClient && targetClient.config && targetClient.config.localInfile === true &&
    hasNativeMethod(targetClient, 'loadDataLocal')
  ) {
    selected = 'mysql-local-infile-tsv';
    accelerated = true;
    reason = 'target explicitly enables the qualified MySQL LOAD DATA LOCAL INFILE runtime';
  } else if (dialect === 'sqlite') {
    selected = 'sqlite-batched-insert';
    reason = 'SQLite has no core bulk-load protocol; bounded batched INSERT remains the safe target strategy';
  } else if (dialect === 'sqlserver') {
    selected = 'sqlserver-batched-insert';
    reason = 'SQL Server TDS bulk-load packet support exists below the client API, but a qualified row bulk writer is not yet exposed';
  }

  if (requested === 'native' && !accelerated) {
    throw new Error('NuBloxSQL data movement native strategy requested but no qualified native target writer is available for ' + (dialect || 'unknown dialect'));
  }

  return freeze({
    schemaVersion: PLAN_SCHEMA_VERSION,
    requested: requested,
    strategy: selected,
    accelerated: accelerated,
    sourceDialect: sourceClient && sourceClient.dialect || null,
    targetDialect: dialect,
    reason: reason,
    fallback: accelerated ? 'portable-batched-insert' : null
  });
}

function identifierFragment(parts) {
  return new sqlApi.SqlFragment(['', ''], [sqlApi.sql.identifier.apply(null, parts)]);
}

function quoteIdentifier(client, parts) {
  if (!client || typeof client.compile !== 'function') throw new TypeError('NuBloxSQL native data movement requires target compile()');
  return client.compile(identifierFragment(parts)).text;
}

function scalar(value, dialect) {
  if (value === null) return { null: true, text: '' };
  if (value === undefined) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return { null: false, text: value.toISOString() };
  }
  if (typeof value === 'string') return { null: false, text: value };
  if (typeof value === 'bigint') return { null: false, text: String(value) };
  if (typeof value === 'boolean') return { null: false, text: dialect === 'postgresql' ? (value ? 't' : 'f') : (value ? '1' : '0') };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return { null: false, text: String(value) };
  }
  return null;
}

function postgresCsv(rows, columns) {
  var lines = [];
  for (var r = 0; r < rows.length; r += 1) {
    var fields = [];
    for (var c = 0; c < columns.length; c += 1) {
      var converted = scalar(rows[r][columns[c].target], 'postgresql');
      if (!converted) return null;
      if (converted.null) fields.push('\\N');
      else fields.push('"' + converted.text.replace(/"/g, '""') + '"');
    }
    lines.push(fields.join(','));
  }
  return lines.join('\n') + '\n';
}

function mysqlEscape(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\0/g, '\\0')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

function mysqlTsv(rows, columns) {
  var lines = [];
  for (var r = 0; r < rows.length; r += 1) {
    var fields = [];
    for (var c = 0; c < columns.length; c += 1) {
      var converted = scalar(rows[r][columns[c].target], 'mysql');
      if (!converted) return null;
      fields.push(converted.null ? '\\N' : mysqlEscape(converted.text));
    }
    lines.push(fields.join('\t'));
  }
  return lines.join('\n') + '\n';
}

async function ensureNativeTarget(client) {
  if (client && typeof client._ensureConnected === 'function') await client._ensureConnected();
  return nativeTarget(client);
}

function nativeOptions(options) {
  return Object.assign({}, options && options.operation || {});
}

async function writePostgres(targetClient, table, columns, rows, options) {
  var payload = postgresCsv(rows, columns);
  if (payload === null) return false;
  var target = await ensureNativeTarget(targetClient);
  if (!target || typeof target.copyFrom !== 'function') return false;
  var tableSql = quoteIdentifier(targetClient, table);
  var columnSql = columns.map(function (entry) { return quoteIdentifier(targetClient, [entry.target]); }).join(', ');
  var statement = 'COPY ' + tableSql + ' (' + columnSql + ") FROM STDIN WITH (FORMAT csv, NULL '\\\\N')";
  await target.copyFrom(statement, payload, nativeOptions(options));
  return true;
}

async function writeMysql(targetClient, table, columns, rows, options) {
  var payload = mysqlTsv(rows, columns);
  if (payload === null) return false;
  var target = await ensureNativeTarget(targetClient);
  if (!target || typeof target.loadDataLocal !== 'function') return false;
  var tableSql = quoteIdentifier(targetClient, table);
  var columnSql = columns.map(function (entry) { return quoteIdentifier(targetClient, [entry.target]); }).join(', ');
  var statement =
    "LOAD DATA LOCAL INFILE '" + MYSQL_FILENAME + "' INTO TABLE " + tableSql +
    " CHARACTER SET utf8mb4 FIELDS TERMINATED BY '\\t' ESCAPED BY '\\\\' LINES TERMINATED BY '\\n' (" +
    columnSql + ')';
  var operation = nativeOptions(options);
  operation.filename = MYSQL_FILENAME;
  await target.loadDataLocal(statement, payload, operation);
  return true;
}

async function writeNative(planValue, targetClient, table, columns, rows, options) {
  if (!planValue || !planValue.accelerated) return false;
  if (planValue.strategy === 'postgresql-copy-csv') return writePostgres(targetClient, table, columns, rows, options);
  if (planValue.strategy === 'mysql-local-infile-tsv') return writeMysql(targetClient, table, columns, rows, options);
  return false;
}

exports.PLAN_SCHEMA_VERSION = PLAN_SCHEMA_VERSION;
exports.STRATEGIES = STRATEGIES;
exports.PREFERENCES = PREFERENCES;
exports.plan = plan;
exports.writeNative = writeNative;
exports._postgresCsv = postgresCsv;
exports._mysqlTsv = mysqlTsv;
