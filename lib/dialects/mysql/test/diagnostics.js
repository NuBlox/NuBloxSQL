'use strict';

var assert = require('assert');
var diagnostics = require('../lib/Diagnostics');

assert.strictEqual(diagnostics.firstKeyword(' SELECT 1'), 'SELECT');
assert.strictEqual(diagnostics.firstKeyword('-- comment\nTABLE t'), 'TABLE');
assert.strictEqual(diagnostics.firstKeyword('/* a */ UPDATE t SET x=1'), 'UPDATE');
assert.doesNotThrow(function () { diagnostics.assertAnalyzeSafety('SELECT 1', {}); });
assert.doesNotThrow(function () { diagnostics.assertAnalyzeSafety('UPDATE t SET x=1', { allowMutation: true }); });
assert.throws(function () { diagnostics.assertAnalyzeSafety('UPDATE t SET x=1', {}); }, /allowMutation/);
assert.throws(function () { diagnostics.normalizeArguments('', [], {}); }, /non-empty SQL/);
assert.throws(function () { diagnostics.normalizeArguments('SELECT 1\0', [], {}); }, /NUL/);

var v1 = diagnostics.normalizeReport({
  query_block: {
    select_id: 1,
    cost_info: { query_cost: '1.20' },
    table: { table_name: 't', access_type: 'ALL', rows_examined_per_scan: 10 }
  }
}, { analyze: false, jsonFormatVersion: 1 });
assert.strictEqual(v1.analyzed, false);
assert.strictEqual(v1.statementExecuted, false);
assert.strictEqual(v1.jsonFormatVersion, 1);
assert.deepStrictEqual(v1.summary.tables, ['t']);
assert.deepStrictEqual(v1.summary.accessTypes, ['ALL']);
assert.strictEqual(Object.isFrozen(v1), true);
assert.strictEqual(Object.isFrozen(v1.plan), true);

var v2 = diagnostics.normalizeReport({
  query: 'select * from t',
  query_type: 'select',
  json_schema_version: '2.0',
  query_plan: {
    operation: 'Table scan on t',
    table_name: 't',
    access_type: 'table',
    estimated_rows: 3,
    estimated_total_cost: 0.55,
    actual_rows: 3,
    actual_loops: 1,
    actual_first_row_ms: 0.01,
    actual_last_row_ms: 0.02
  }
}, { analyze: true, jsonFormatVersion: 2 });
assert.strictEqual(v2.analyzed, true);
assert.strictEqual(v2.statementExecuted, true);
assert.strictEqual(v2.summary.queryType, 'select');
assert.strictEqual(v2.summary.actualRows, 3);
assert.strictEqual(v2.summary.estimatedTotalCost, 0.55);
assert.deepStrictEqual(v2.summary.operations, ['Table scan on t']);

console.log('ok - MySQL structured EXPLAIN diagnostics helpers');
