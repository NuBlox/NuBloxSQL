'use strict';

var assert = require('assert');
var sqlite = require('..');

var db = sqlite.createConnection();
db.exec('CREATE TABLE numbers(id INTEGER PRIMARY KEY, value TEXT)');
for (var i = 1; i <= 20; i += 1) db.run('INSERT INTO numbers(value) VALUES (?)', ['value-' + i]);

var caps = db.resourceGovernanceCapabilities();
assert.strictEqual(caps.pageCountLimit, true);
assert.strictEqual(caps.queryResultBudgets, true);
assert.strictEqual(caps.hardenedProfile, true);
assert.strictEqual(typeof caps.mutableRuntimeLimits, 'boolean');

var budget = db.queryBudget({ profile: 'hardened' });
assert.strictEqual(budget.maxRows, 10000);
assert.strictEqual(budget.maxRowBytes, 1024 * 1024);
assert.strictEqual(budget.maxResultBytes, 16 * 1024 * 1024);

var limited = db.governedQuery('SELECT * FROM numbers ORDER BY id', undefined, { maxRows: 5 });
assert.fail('governedQuery should enforce maxRows');
