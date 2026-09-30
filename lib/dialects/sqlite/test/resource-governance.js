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
assert.deepStrictEqual(budget, { maxRows: 10000, maxRowBytes: 1024 * 1024, maxResultBytes: 16 * 1024 * 1024 });

assert.throws(function () {
  db.governedQuery('SELECT * FROM numbers ORDER BY id', undefined, { maxRows: 5 });
}, function (error) {
  return error && error.name === 'SqliteResultLimitError' && error.category === 'resource-limit' && error.limit === 5;
});

var maxPages = db.pageCountLimit();
assert(Number.isInteger(maxPages) && maxPages > 0);
var hardened = db.applyHardenedProfile({ maxPageCount: Math.max(1000, db.storageState().pageCount + 100) });
assert.strictEqual(hardened.profile, 'hardened');
assert.strictEqual(hardened.queryBudget.maxRows, 10000);
assert.strictEqual(typeof hardened.mutableRuntimeLimits, 'boolean');
assert(Number.isInteger(hardened.maxPageCount) && hardened.maxPageCount > 0);

if (caps.mutableRuntimeLimits) {
  var before = db.runtimeLimits();
  assert(Number.isInteger(before.sqlLength));
  var setValue = Math.min(before.sqlLength, 900000);
  assert.strictEqual(db.setRuntimeLimit('sqlLength', setValue), setValue);
  assert.strictEqual(db.runtimeLimits().sqlLength, setValue);
  assert.throws(function () { db.setRuntimeLimit('notALimit', 1); }, RangeError);
} else {
  assert.deepStrictEqual(db.runtimeLimits(), {});
  assert.throws(function () { db.setRuntimeLimit('sqlLength', 1000); }, function (error) { return error && error.code === 'NUBLOXSQL_UNSUPPORTED'; });
}

db.close();
console.log('SQLite resource governance contract passed');
