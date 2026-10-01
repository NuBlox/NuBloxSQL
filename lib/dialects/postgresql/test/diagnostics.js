'use strict';

var assert = require('assert');
var diagnostics = require('../lib/DiagnosticsConnection');

var pg15 = { parameters: { server_version: '15.14' } };
var pg16 = { parameters: { server_version: '16.10' } };
var pg17 = { parameters: { server_version: '17.6' } };
var pg18 = { parameters: { server_version: '18.1' } };

assert.strictEqual(diagnostics.serverMajor(pg15), 15);
assert.strictEqual(
  diagnostics.buildExplainSql(pg15, 'SELECT 1', { analyze: true, buffers: true, wal: true, timing: false, summary: true }),
  'EXPLAIN (FORMAT JSON, ANALYZE TRUE, BUFFERS TRUE, WAL TRUE, TIMING FALSE, SUMMARY TRUE) SELECT 1'
);
assert.strictEqual(
  diagnostics.buildExplainSql(pg16, 'SELECT * FROM t WHERE id = $1', { genericPlan: true, settings: true }),
  'EXPLAIN (FORMAT JSON, SETTINGS TRUE, GENERIC_PLAN TRUE) SELECT * FROM t WHERE id = $1'
);
assert.strictEqual(
  diagnostics.buildExplainSql(pg17, 'SELECT 1', { analyze: true, serialize: 'text' }),
  'EXPLAIN (FORMAT JSON, ANALYZE TRUE, SERIALIZE TEXT) SELECT 1'
);
assert.strictEqual(
  diagnostics.buildExplainSql(pg18, 'SELECT 1', { memory: true }),
  'EXPLAIN (FORMAT JSON, MEMORY TRUE) SELECT 1'
);
assert.throws(function () { diagnostics.buildExplainSql(pg15, 'SELECT $1', { genericPlan: true }); }, /PostgreSQL 16/);
assert.throws(function () { diagnostics.buildExplainSql(pg16, 'SELECT 1', { analyze: true, serialize: 'text' }); }, /PostgreSQL 17/);
assert.throws(function () { diagnostics.buildExplainSql(pg17, 'SELECT 1', { memory: true }); }, /PostgreSQL 18/);
assert.throws(function () { diagnostics.buildExplainSql(pg18, 'SELECT 1', { genericPlan: true, analyze: true }); }, /cannot be combined/);
assert.throws(function () { diagnostics.buildExplainSql(pg18, 'SELECT 1', { wal: true }); }, /requires ANALYZE/);
assert.throws(function () { diagnostics.buildExplainSql(pg18, 'SELECT 1', { timing: false }); }, /requires ANALYZE/);
assert.throws(function () { diagnostics.buildExplainSql(pg18, 'SELECT 1', { serialize: 'text' }); }, /requires ANALYZE/);

var report = diagnostics.normalizeReport([{
  Plan: {
    'Node Type': 'Hash Join', 'Total Cost': 42.5, 'Plan Rows': 10, 'Actual Rows': 8, 'Actual Total Time': 1.25,
    Plans: [
      { 'Node Type': 'Seq Scan', 'Plan Rows': 20 },
      { 'Node Type': 'Index Scan', 'Plan Rows': 10, Plans: [{ 'Node Type': 'Bitmap Index Scan' }] }
    ]
  },
  'Planning Time': 0.4,
  'Execution Time': 1.8,
  Settings: { work_mem: '4MB' }
}], { analyze: true });
assert.strictEqual(report.analyzed, true);
assert.strictEqual(report.statementExecuted, true);
assert.strictEqual(report.summary.rootNodeType, 'Hash Join');
assert.strictEqual(report.summary.nodeCount, 4);
assert.strictEqual(report.summary.maxDepth, 2);
assert.strictEqual(report.summary.nodeTypes['Seq Scan'], 1);
assert.strictEqual(report.summary.executionTime, 1.8);
assert.strictEqual(report.settings.work_mem, '4MB');
assert.ok(Object.isFrozen(report));
assert.ok(Object.isFrozen(report.root));
assert.ok(Object.isFrozen(report.summary.nodeTypes));

console.log('ok - PostgreSQL structured EXPLAIN diagnostic contracts');
