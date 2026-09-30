'use strict';

var assert = require('assert');
var sqlite = require('..');

var db = sqlite.createConnection({ readBigInts: true });

db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL, score INTEGER NOT NULL) STRICT');
var insert = db.prepare('INSERT INTO users (id, email, score) VALUES (?, ?, ?)');
for (var i = 1; i <= 64; i += 1) insert.run([BigInt(i), 'user' + i + '@example.test', BigInt(i % 10)]);

var scan = db.explainQueryPlan('SELECT id, email FROM users WHERE score = ?', [3]);
assert(Object.isFrozen(scan));
assert(Object.isFrozen(scan.nodes));
assert(Object.isFrozen(scan.summary));
assert(Object.isFrozen(scan.warnings));
assert.strictEqual(scan.summary.hasFullScan, true);
assert(scan.warnings.some(function (entry) { return entry.code === 'full-table-scan'; }));

db.exec('CREATE INDEX idx_users_score ON users(score)');
var indexed = db.explainQueryPlan('SELECT id, email FROM users WHERE score = ?', [3]);
assert.strictEqual(indexed.summary.usesIndex, true);
assert.strictEqual(indexed.summary.hasFullScan, false);
assert(indexed.nodes.some(function (node) { return node.kind === 'search' && node.index === 'idx_users_score'; }));

var sortPlan = db.explainQueryPlan('SELECT id, email FROM users ORDER BY email');
assert.strictEqual(sortPlan.summary.usesTempBtree, true);
assert(sortPlan.warnings.some(function (entry) { return entry.code === 'temporary-btree'; }));

var explained = db.explain('SELECT id FROM users WHERE score = ?', [3]);
assert(Object.isFrozen(explained));
assert(Object.isFrozen(explained.opcodes));
assert(explained.opcodeCount > 0);
assert(explained.uniqueOpcodes.length > 0);
assert(explained.opcodes.every(Object.isFrozen));
assert(explained.opcodes.some(function (entry) { return entry.opcode === 'OpenRead'; }));

var statement = db.prepare('SELECT id, email FROM users WHERE score = ?');
var privateMetadata = statement.metadata();
assert(Object.isFrozen(privateMetadata));
assert(Object.isFrozen(privateMetadata.columns));
assert.strictEqual(privateMetadata.sourceSql, undefined);
assert.strictEqual(privateMetadata.expandedSql, undefined);
assert.strictEqual(privateMetadata.native.sourceSql, true);
assert.strictEqual(privateMetadata.native.expandedSql, true);

var sourceMetadata = statement.metadata({ includeSql: true });
assert.strictEqual(sourceMetadata.sourceSql, 'SELECT id, email FROM users WHERE score = ?');
assert.strictEqual(sourceMetadata.expandedSql, undefined);

statement.get([3]);
var expandedMetadata = statement.metadata({ includeExpandedSql: true });
assert.strictEqual(typeof expandedMetadata.expandedSql, 'string');
assert(expandedMetadata.expandedSql.indexOf('3') >= 0);

var diagnosis = db.diagnoseQuery('SELECT id, email FROM users WHERE score = ?', [3], { includeOpcodes: true });
assert(Object.isFrozen(diagnosis));
assert.strictEqual(diagnosis.statement.sourceSql, undefined);
assert.strictEqual(diagnosis.statement.expandedSql, undefined);
assert.strictEqual(diagnosis.plan.summary.usesIndex, true);
assert(diagnosis.explain.opcodeCount > 0);

var diagnosisWithSql = db.diagnoseQuery('SELECT id FROM users WHERE score = ?', [3], { includeSql: true });
assert.strictEqual(diagnosisWithSql.statement.sourceSql, 'SELECT id FROM users WHERE score = ?');
assert.strictEqual(diagnosisWithSql.statement.expandedSql, undefined);

assert.throws(function () { db.explainQueryPlan(''); }, /non-empty SQL/);
assert.throws(function () { db.explain('   '); }, /non-empty SQL/);

db.close();
console.log('SQLite query diagnostics contract: ok');
