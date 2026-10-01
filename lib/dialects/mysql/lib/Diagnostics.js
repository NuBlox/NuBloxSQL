'use strict';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
  return Object.freeze(value);
}

function normalizeArguments(sql, parameters, options) {
  if (typeof sql !== 'string' || !sql.trim()) throw new TypeError('MySQL EXPLAIN requires non-empty SQL');
  if (sql.indexOf('\0') !== -1) throw new TypeError('MySQL EXPLAIN SQL must not contain NUL');
  if (parameters && !Array.isArray(parameters) && typeof parameters === 'object' && options === undefined) {
    options = parameters;
    parameters = [];
  }
  parameters = parameters || [];
  options = options || {};
  if (!Array.isArray(parameters)) throw new TypeError('MySQL EXPLAIN parameters must be an array');
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('MySQL EXPLAIN options must be an object');
  return { sql: sql, parameters: parameters, options: options };
}

function queryOptions(options) {
  var result = {};
  ['timeout', 'deadline', 'signal', 'maxRows', 'maxResultBytes', 'maxRowBytes'].forEach(function (name) {
    if (options[name] !== undefined) result[name] = options[name];
  });
  return result;
}

async function execute(connection, sql, parameters, options) {
  if (!parameters.length) return connection.query(sql, options);
  var statement = await connection.prepare(sql, options);
  try { return await statement.execute(parameters, options); }
  finally {
    if (!statement.closed && connection.connected && !connection.ended) {
      try { await statement.close(); } catch (error) { connection.destroy(error); }
    }
  }
}

function firstColumn(row) {
  if (!row || typeof row !== 'object') return undefined;
  var keys = Object.keys(row);
  return keys.length ? row[keys[0]] : undefined;
}

function parseDocument(value) {
  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  if (typeof value === 'string') value = JSON.parse(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MySQL EXPLAIN returned an unexpected JSON document');
  return value;
}

function inventory(document) {
  var nodeCount = 0;
  var maxDepth = 0;
  var tables = Object.create(null);
  var accessTypes = Object.create(null);
  var operations = Object.create(null);
  function visit(value, depth) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(function (item) { visit(item, depth); }); return; }
    var looksLikeNode = value.operation !== undefined || value.table_name !== undefined || value.access_type !== undefined || value.cost_info !== undefined;
    if (looksLikeNode) {
      nodeCount += 1;
      if (depth > maxDepth) maxDepth = depth;
      if (value.table_name) tables[value.table_name] = true;
      if (value.access_type) accessTypes[value.access_type] = true;
      if (value.operation) operations[value.operation] = true;
    }
    Object.keys(value).forEach(function (key) {
      if (value[key] && typeof value[key] === 'object') visit(value[key], depth + (looksLikeNode ? 1 : 0));
    });
  }
  visit(document, 0);
  return {
    nodeCount: nodeCount,
    maxDepth: maxDepth,
    tables: Object.keys(tables).sort(),
    accessTypes: Object.keys(accessTypes).sort(),
    operations: Object.keys(operations)
  };
}

function normalizeReport(document, options) {
  document = parseDocument(document);
  var inv = inventory(document);
  var root = document.query_plan || document.query_block || document;
  var summary = {
    nodeCount: inv.nodeCount,
    maxDepth: inv.maxDepth,
    tables: inv.tables,
    accessTypes: inv.accessTypes,
    operations: inv.operations,
    queryType: document.query_type || null,
    jsonSchemaVersion: document.json_schema_version || null,
    estimatedRows: root && root.estimated_rows !== undefined ? root.estimated_rows : null,
    estimatedTotalCost: root && root.estimated_total_cost !== undefined ? root.estimated_total_cost : null,
    actualRows: root && root.actual_rows !== undefined ? root.actual_rows : null,
    actualLoops: root && root.actual_loops !== undefined ? root.actual_loops : null,
    actualFirstRowMs: root && root.actual_first_row_ms !== undefined ? root.actual_first_row_ms : null,
    actualLastRowMs: root && root.actual_last_row_ms !== undefined ? root.actual_last_row_ms : null
  };
  return deepFreeze({
    format: 'json',
    analyzed: options.analyze === true,
    statementExecuted: options.analyze === true,
    jsonFormatVersion: options.jsonFormatVersion || null,
    plan: document,
    root: root,
    summary: summary
  });
}

function firstKeyword(sql) {
  var text = sql.replace(/^\s+/, '');
  while (text.indexOf('--') === 0 || text.indexOf('#') === 0 || text.indexOf('/*') === 0) {
    if (text.indexOf('/*') === 0) {
      var end = text.indexOf('*/');
      if (end === -1) return '';
      text = text.slice(end + 2).replace(/^\s+/, '');
    } else {
      var nl = text.indexOf('\n');
      if (nl === -1) return '';
      text = text.slice(nl + 1).replace(/^\s+/, '');
    }
  }
  var match = text.match(/^([A-Za-z]+)/);
  return match ? match[1].toUpperCase() : '';
}

function assertAnalyzeSafety(sql, options) {
  var keyword = firstKeyword(sql);
  if (keyword === 'SELECT' || keyword === 'TABLE') return;
  if (options.allowMutation === true) return;
  throw new RangeError('MySQL EXPLAIN ANALYZE executes the statement; non-SELECT/TABLE SQL requires allowMutation: true');
}

async function readJsonVersion(connection, options) {
  var result = await connection.query('SELECT @@SESSION.explain_json_format_version AS explainJsonFormatVersion', options);
  return Number(result.rows[0].explainJsonFormatVersion);
}

async function withJsonV2(connection, options, fn) {
  var previous = await readJsonVersion(connection, options);
  if (previous !== 2) await connection.query('SET SESSION explain_json_format_version = 2', options);
  var primaryError = null;
  try { return await fn(); }
  catch (error) { primaryError = error; throw error; }
  finally {
    if (previous !== 2 && connection.connected && !connection.ended) {
      try { await connection.query('SET SESSION explain_json_format_version = ' + previous, options); }
      catch (restoreError) {
        connection.destroy(restoreError);
        if (!primaryError) throw restoreError;
      }
    }
  }
}

function install(runtime, poolModule) {
  var Connection = runtime.Connection;
  var Pool = poolModule.Pool;

  Connection.prototype.explain = async function explain(sql, parameters, options) {
    var args = normalizeArguments(sql, parameters, options);
    var qopts = queryOptions(args.options);
    var result = await execute(this, 'EXPLAIN FORMAT=JSON ' + args.sql, args.parameters, qopts);
    if (!result.rows || result.rows.length !== 1) throw new Error('MySQL EXPLAIN returned an unexpected row count');
    var version = null;
    try { version = await readJsonVersion(this, qopts); } catch (_) {}
    var reportOptions = Object.assign({}, args.options, { analyze: false, jsonFormatVersion: version });
    return normalizeReport(firstColumn(result.rows[0]), reportOptions);
  };

  Connection.prototype.explainAnalyze = async function explainAnalyze(sql, parameters, options) {
    var args = normalizeArguments(sql, parameters, options);
    assertAnalyzeSafety(args.sql, args.options);
    var self = this;
    var qopts = queryOptions(args.options);
    return withJsonV2(this, qopts, async function () {
      var result = await execute(self, 'EXPLAIN ANALYZE FORMAT=JSON ' + args.sql, args.parameters, qopts);
      if (!result.rows || result.rows.length !== 1) throw new Error('MySQL EXPLAIN ANALYZE returned an unexpected row count');
      var reportOptions = Object.assign({}, args.options, { analyze: true, jsonFormatVersion: 2 });
      return normalizeReport(firstColumn(result.rows[0]), reportOptions);
    });
  };

  Connection.prototype.diagnoseQuery = function diagnoseQuery(sql, parameters, options) {
    return this.explain(sql, parameters, options);
  };

  async function pooled(method, sql, parameters, options) {
    var args = normalizeArguments(sql, parameters, options);
    var connection = await this.getConnection(args.options.acquire || {});
    try { return await connection[method](args.sql, args.parameters, args.options); }
    finally {
      if (this._all.has(connection) && !connection.ended && !connection.inTransaction && !connection._queryState) this.releaseConnection(connection);
    }
  }
  Pool.prototype.explain = function explain(sql, parameters, options) { return pooled.call(this, 'explain', sql, parameters, options); };
  Pool.prototype.explainAnalyze = function explainAnalyze(sql, parameters, options) { return pooled.call(this, 'explainAnalyze', sql, parameters, options); };
  Pool.prototype.diagnoseQuery = function diagnoseQuery(sql, parameters, options) { return pooled.call(this, 'diagnoseQuery', sql, parameters, options); };
}

exports.install = install;
exports.normalizeArguments = normalizeArguments;
exports.normalizeReport = normalizeReport;
exports.firstKeyword = firstKeyword;
exports.assertAnalyzeSafety = assertAnalyzeSafety;
