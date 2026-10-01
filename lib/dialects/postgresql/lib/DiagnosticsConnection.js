'use strict';

var notifications = require('./NotificationConnection');

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
  return Object.freeze(value);
}

function serverMajor(connection) {
  var version = connection && connection.parameters && connection.parameters.server_version;
  var match = String(version || '').match(/^(\d+)/);
  return match ? Number(match[1]) : null;
}

function requireVersion(connection, option, minimum) {
  var major = serverMajor(connection);
  if (major !== null && major < minimum) {
    throw new RangeError('PostgreSQL EXPLAIN ' + option + ' requires PostgreSQL ' + minimum + ' or newer; connected server is ' + connection.parameters.server_version);
  }
}

function normalizeBoolean(name, value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new TypeError('PostgreSQL EXPLAIN ' + name + ' must be a boolean');
  return value;
}

function normalizeExplainArguments(sql, parameters, options) {
  if (typeof sql !== 'string' || sql.trim().length === 0) throw new TypeError('PostgreSQL EXPLAIN requires non-empty SQL');
  if (sql.indexOf('\0') !== -1) throw new TypeError('PostgreSQL EXPLAIN SQL must not contain NUL');
  if (parameters && !Array.isArray(parameters) && typeof parameters === 'object' && options === undefined) {
    options = parameters;
    parameters = [];
  }
  parameters = parameters || [];
  options = options || {};
  if (!Array.isArray(parameters)) throw new TypeError('PostgreSQL EXPLAIN parameters must be an array');
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('PostgreSQL EXPLAIN options must be an object');
  return { sql: sql, parameters: parameters, options: options };
}

function buildExplainSql(connection, sql, options) {
  var analyze = normalizeBoolean('analyze', options.analyze) === true;
  var genericPlan = normalizeBoolean('genericPlan', options.genericPlan) === true;
  var serialize = options.serialize;
  var memory = normalizeBoolean('memory', options.memory) === true;
  if (genericPlan) {
    requireVersion(connection, 'GENERIC_PLAN', 16);
    if (analyze) throw new RangeError('PostgreSQL EXPLAIN GENERIC_PLAN cannot be combined with ANALYZE');
  }
  if (serialize !== undefined) {
    requireVersion(connection, 'SERIALIZE', 17);
    if (!analyze) throw new RangeError('PostgreSQL EXPLAIN SERIALIZE requires ANALYZE');
    if (serialize !== 'text' && serialize !== 'binary' && serialize !== 'none') throw new RangeError('PostgreSQL EXPLAIN serialize must be text, binary, or none');
  }
  if (memory) requireVersion(connection, 'MEMORY', 18);
  if (options.wal === true && !analyze) throw new RangeError('PostgreSQL EXPLAIN WAL requires ANALYZE');
  if (options.timing !== undefined && !analyze) throw new RangeError('PostgreSQL EXPLAIN TIMING requires ANALYZE');

  var entries = ['FORMAT JSON'];
  function addBoolean(name, value) {
    value = normalizeBoolean(name.toLowerCase(), value);
    if (value !== undefined) entries.push(name + ' ' + (value ? 'TRUE' : 'FALSE'));
  }
  addBoolean('ANALYZE', options.analyze);
  addBoolean('VERBOSE', options.verbose);
  addBoolean('COSTS', options.costs);
  addBoolean('SETTINGS', options.settings);
  if (genericPlan) entries.push('GENERIC_PLAN TRUE');
  addBoolean('BUFFERS', options.buffers);
  addBoolean('WAL', options.wal);
  addBoolean('TIMING', options.timing);
  addBoolean('SUMMARY', options.summary);
  if (serialize !== undefined) entries.push('SERIALIZE ' + serialize.toUpperCase());
  if (memory) entries.push('MEMORY TRUE');
  return 'EXPLAIN (' + entries.join(', ') + ') ' + sql;
}

function firstColumn(row) {
  if (!row || typeof row !== 'object') return undefined;
  var keys = Object.keys(row);
  return keys.length ? row[keys[0]] : undefined;
}

function countPlanNodes(root) {
  var count = 0;
  var maxDepth = 0;
  var nodeTypes = Object.create(null);
  function visit(node, depth) {
    if (!node || typeof node !== 'object') return;
    count += 1;
    if (depth > maxDepth) maxDepth = depth;
    var type = node['Node Type'];
    if (type) nodeTypes[type] = (nodeTypes[type] || 0) + 1;
    var children = node.Plans;
    if (Array.isArray(children)) children.forEach(function (child) { visit(child, depth + 1); });
  }
  visit(root, 0);
  return { count: count, maxDepth: maxDepth, nodeTypes: nodeTypes };
}

function normalizeReport(document, options) {
  if (typeof document === 'string') document = JSON.parse(document);
  if (!Array.isArray(document) || !document.length || !document[0] || typeof document[0] !== 'object') {
    throw new Error('PostgreSQL EXPLAIN returned an unexpected JSON document');
  }
  var item = document[0];
  var root = item.Plan;
  if (!root || typeof root !== 'object') throw new Error('PostgreSQL EXPLAIN JSON document is missing Plan');
  var inventory = countPlanNodes(root);
  var summary = Object.freeze({
    rootNodeType: root['Node Type'] || null,
    totalCost: root['Total Cost'] === undefined ? null : root['Total Cost'],
    planRows: root['Plan Rows'] === undefined ? null : root['Plan Rows'],
    actualRows: root['Actual Rows'] === undefined ? null : root['Actual Rows'],
    actualTotalTime: root['Actual Total Time'] === undefined ? null : root['Actual Total Time'],
    planningTime: item['Planning Time'] === undefined ? null : item['Planning Time'],
    executionTime: item['Execution Time'] === undefined ? null : item['Execution Time'],
    nodeCount: inventory.count,
    maxDepth: inventory.maxDepth,
    nodeTypes: Object.freeze(Object.assign({}, inventory.nodeTypes))
  });
  return deepFreeze({
    format: 'json',
    analyzed: options.analyze === true,
    statementExecuted: options.analyze === true,
    plan: document,
    root: root,
    summary: summary,
    settings: item.Settings || null,
    triggers: item.Triggers || null,
    jit: item.JIT || null
  });
}

function Connection(config) {
  notifications.Connection.call(this, config);
}
Connection.prototype = Object.create(notifications.Connection.prototype);
Connection.prototype.constructor = Connection;

Connection.prototype.explain = async function explain(sql, parameters, options) {
  var args = normalizeExplainArguments(sql, parameters, options);
  var statement = buildExplainSql(this, args.sql, args.options);
  var queryOptions = {};
  ['timeout', 'signal', 'maxRows', 'maxResultBytes', 'maxRowBytes'].forEach(function (name) {
    if (args.options[name] !== undefined) queryOptions[name] = args.options[name];
  });
  var result = args.parameters.length
    ? await this.execute(statement, args.parameters, queryOptions)
    : await this.query(statement, queryOptions);
  if (!result.rows || result.rows.length !== 1) throw new Error('PostgreSQL EXPLAIN returned an unexpected row count');
  return normalizeReport(firstColumn(result.rows[0]), args.options);
};

Connection.prototype.explainAnalyze = function explainAnalyze(sql, parameters, options) {
  if (parameters && !Array.isArray(parameters) && typeof parameters === 'object' && options === undefined) {
    options = parameters;
    parameters = [];
  }
  options = Object.assign({}, options || {}, { analyze: true });
  return this.explain(sql, parameters || [], options);
};

Connection.prototype.diagnoseQuery = function diagnoseQuery(sql, parameters, options) {
  return this.explain(sql, parameters, options);
};

exports.Connection = Connection;
exports.PreparedStatement = notifications.PreparedStatement;
exports.PortalCursor = notifications.PortalCursor;
exports.PostgreSqlError = notifications.PostgreSqlError;
exports.PostgreSqlCancellationError = notifications.PostgreSqlCancellationError;
exports.PostgreSqlResultLimitError = notifications.PostgreSqlResultLimitError;
exports.DEFAULT_RESULT_LIMITS = notifications.DEFAULT_RESULT_LIMITS;
exports.DEFAULT_COPY_BUFFER_BYTES = notifications.DEFAULT_COPY_BUFFER_BYTES;
exports.TYPE_OIDS = notifications.TYPE_OIDS;
exports.ISOLATION_LEVELS = notifications.ISOLATION_LEVELS;
exports.buildExplainSql = buildExplainSql;
exports.normalizeReport = normalizeReport;
exports.serverMajor = serverMajor;
