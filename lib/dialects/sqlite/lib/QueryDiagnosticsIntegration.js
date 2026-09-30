'use strict';

function freezeArray(values) {
  return Object.freeze(values.map(function (value) {
    return value && typeof value === 'object' && !Object.isFrozen(value) ? Object.freeze(value) : value;
  }));
}

function integer(value) {
  if (typeof value === 'bigint') return Number(value);
  return Number(value);
}

function classifyDetail(detail) {
  var text = String(detail || '');
  var upper = text.toUpperCase();
  var kind = 'other';
  if (/^SCAN\b/.test(upper)) kind = 'scan';
  else if (/^SEARCH\b/.test(upper)) kind = 'search';
  else if (upper.indexOf('USE TEMP B-TREE') >= 0) kind = 'temp-btree';
  else if (upper.indexOf('MULTI-INDEX') >= 0) kind = 'multi-index';
  else if (upper.indexOf('SUBQUERY') >= 0) kind = 'subquery';

  var tableMatch = text.match(/^(?:SCAN|SEARCH)\s+(?:TABLE\s+)?([^\s]+)/i);
  var indexMatch = text.match(/USING\s+(?:COVERING\s+)?(?:AUTOMATIC\s+)?INDEX\s+([^\s(]+)/i);

  return Object.freeze({
    kind: kind,
    table: tableMatch ? tableMatch[1] : null,
    index: indexMatch ? indexMatch[1] : null,
    covering: /USING\s+COVERING\s+INDEX/i.test(text),
    automaticIndex: /USING\s+(?:AUTOMATIC\s+)(?:COVERING\s+)?INDEX/i.test(text) || /USING\s+(?:COVERING\s+)?AUTOMATIC\s+INDEX/i.test(text),
    tempBtree: upper.indexOf('USE TEMP B-TREE') >= 0
  });
}

function normalizePlanRows(rows) {
  return freezeArray(rows.map(function (row) {
    var detail = row.detail === undefined ? '' : String(row.detail);
    var classification = classifyDetail(detail);
    return Object.freeze({
      id: integer(row.id),
      parentId: integer(row.parent),
      auxiliary: integer(row.notused === undefined ? row.aux : row.notused),
      detail: detail,
      kind: classification.kind,
      table: classification.table,
      index: classification.index,
      covering: classification.covering,
      automaticIndex: classification.automaticIndex,
      tempBtree: classification.tempBtree
    });
  }));
}

function warning(code, message, nodeId) {
  return Object.freeze({ code: code, message: message, nodeId: nodeId === undefined ? null : nodeId });
}

function buildWarnings(nodes) {
  var warnings = [];
  nodes.forEach(function (node) {
    if (node.kind === 'scan' && !node.index) warnings.push(warning('full-table-scan', 'SQLite query plan includes a scan without an explicit index', node.id));
    if (node.tempBtree) warnings.push(warning('temporary-btree', 'SQLite query plan uses a temporary B-tree for sorting, grouping or distinct processing', node.id));
    if (node.automaticIndex) warnings.push(warning('automatic-index', 'SQLite created or selected an automatic index for this plan', node.id));
  });
  return freezeArray(warnings);
}

function summarize(nodes) {
  return Object.freeze({
    nodeCount: nodes.length,
    scans: nodes.filter(function (node) { return node.kind === 'scan'; }).length,
    searches: nodes.filter(function (node) { return node.kind === 'search'; }).length,
    usesIndex: nodes.some(function (node) { return node.index !== null || /USING\s+(?:COVERING\s+)?INDEX/i.test(node.detail); }),
    usesCoveringIndex: nodes.some(function (node) { return node.covering; }),
    usesAutomaticIndex: nodes.some(function (node) { return node.automaticIndex; }),
    hasFullScan: nodes.some(function (node) { return node.kind === 'scan' && !node.index; }),
    usesTempBtree: nodes.some(function (node) { return node.tempBtree; })
  });
}

function normalizeOpcodes(rows) {
  return freezeArray(rows.map(function (row) {
    return Object.freeze({
      address: integer(row.addr),
      opcode: String(row.opcode),
      p1: integer(row.p1),
      p2: integer(row.p2),
      p3: integer(row.p3),
      p4: row.p4 === null || row.p4 === undefined ? null : String(row.p4),
      p5: integer(row.p5),
      comment: row.comment === null || row.comment === undefined ? null : String(row.comment)
    });
  }));
}

function assertSql(sql) {
  if (typeof sql !== 'string' || sql.trim().length === 0) throw new TypeError('SQLite diagnostics require a non-empty SQL string');
  return sql;
}

function install(runtime) {
  var Connection = runtime.Connection;
  var PreparedStatement = runtime.PreparedStatement;

  if (typeof PreparedStatement.prototype.metadata !== 'function') {
    PreparedStatement.prototype.metadata = function metadata(options) {
      options = options || {};
      var native = this._statement;
      var result = {
        columns: freezeArray(this.columns()),
        readBigInts: this._options.readBigInts === true,
        native: Object.freeze({
          sourceSql: typeof native.sourceSQL === 'string',
          expandedSql: typeof native.expandedSQL === 'string'
        })
      };
      if (options.includeSql === true && typeof native.sourceSQL === 'string') result.sourceSql = native.sourceSQL;
      if (options.includeExpandedSql === true && typeof native.expandedSQL === 'string') result.expandedSql = native.expandedSQL;
      return Object.freeze(result);
    };
  }

  Connection.prototype.explainQueryPlan = function explainQueryPlan(sql, parameters) {
    this._assertOpen();
    sql = assertSql(sql);
    var rows = this.query('EXPLAIN QUERY PLAN ' + sql, parameters).rows;
    var nodes = normalizePlanRows(rows);
    return Object.freeze({
      nodes: nodes,
      summary: summarize(nodes),
      warnings: buildWarnings(nodes)
    });
  };

  Connection.prototype.explain = function explain(sql, parameters) {
    this._assertOpen();
    sql = assertSql(sql);
    var opcodes = normalizeOpcodes(this.query('EXPLAIN ' + sql, parameters).rows);
    var unique = [];
    opcodes.forEach(function (entry) { if (unique.indexOf(entry.opcode) === -1) unique.push(entry.opcode); });
    return Object.freeze({
      opcodes: opcodes,
      opcodeCount: opcodes.length,
      uniqueOpcodes: Object.freeze(unique)
    });
  };

  Connection.prototype.diagnoseQuery = function diagnoseQuery(sql, parameters, options) {
    this._assertOpen();
    sql = assertSql(sql);
    options = options || {};
    var statement = this.prepare(sql);
    var metadata = statement.metadata({
      includeSql: options.includeSql === true,
      includeExpandedSql: options.includeExpandedSql === true
    });
    var plan = this.explainQueryPlan(sql, parameters);
    var result = {
      statement: metadata,
      plan: plan
    };
    if (options.includeOpcodes === true) result.explain = this.explain(sql, parameters);
    return Object.freeze(result);
  };
}

exports.install = install;
exports.classifyDetail = classifyDetail;
