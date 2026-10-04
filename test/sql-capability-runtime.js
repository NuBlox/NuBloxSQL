'use strict';

var assert = require('assert');
var sql = require('..');

assert.strictEqual(sql.capabilityModel.compareVersion('3.45.0', '3.45.0'), 0);
assert.strictEqual(sql.capabilityModel.compareVersion('3.46.0', '3.45.0'), 1);
assert.strictEqual(sql.capabilityModel.compareVersion('3.44.2', '3.45.0'), -1);

var sqliteOld = sql.capabilityModel.qualify('sqlite', { version: '3.38.5' });
var oldRightJoin = sqliteOld.entries.find(function (entry) { return entry.path === 'queries.joins.right'; });
assert.ok(oldRightJoin);
assert.strictEqual(oldRightJoin.resolved, true);
assert.strictEqual(oldRightJoin.supported, false);
assert.strictEqual(oldRightJoin.resolution, 'runtime-version');

var sqliteNew = sql.capabilityModel.qualify('sqlite', {
  version: '3.49.1',
  features: { 'expressions.json': true, 'extensions.fts5': false }
});
var rightJoin = sqliteNew.entries.find(function (entry) { return entry.path === 'queries.joins.right'; });
var json = sqliteNew.entries.find(function (entry) { return entry.path === 'expressions.json'; });
var fts5 = sqliteNew.entries.find(function (entry) { return entry.path === 'extensions.fts5'; });
assert.strictEqual(rightJoin.supported, true);
assert.strictEqual(rightJoin.resolution, 'runtime-version');
assert.strictEqual(json.supported, true);
assert.strictEqual(json.resolution, 'runtime-probe');
assert.strictEqual(fts5.supported, false);
assert.strictEqual(fts5.resolution, 'runtime-probe');
assert.ok(sqliteNew.summary.runtimeQualified > 0);
assert.ok(Object.isFrozen(sqliteNew));
assert.ok(Object.isFrozen(sqliteNew.entries));

var pg14 = sql.capabilityModel.qualify('postgresql', { version: '14' });
var pg14Merge = pg14.entries.find(function (entry) { return entry.path === 'statements.merge'; });
assert.ok(pg14Merge);
assert.strictEqual(pg14Merge.supported, false);
assert.strictEqual(pg14Merge.resolution, 'runtime-version');

var pg17 = sql.capabilityModel.qualify('postgresql', { version: '17' });
var pg17Virtual = pg17.entries.find(function (entry) { return entry.path === 'integrity.generatedVirtual'; });
assert.ok(pg17Virtual);
assert.strictEqual(pg17Virtual.supported, false);
assert.strictEqual(pg17Virtual.resolution, 'runtime-version');

var pg18Versioned = sql.capabilityModel.qualify('postgresql', { version: '18' });
var pg18Virtual = pg18Versioned.entries.find(function (entry) { return entry.path === 'integrity.generatedVirtual'; });
assert.ok(pg18Virtual);
assert.strictEqual(pg18Virtual.supported, true);
assert.strictEqual(pg18Virtual.resolution, 'runtime-version');

var mysql8013 = sql.capabilityModel.qualify('mysql', { version: '8.0.13' });
var mysql8013Lateral = mysql8013.entries.find(function (entry) { return entry.path === 'queries.joins.lateral'; });
assert.ok(mysql8013Lateral);
assert.strictEqual(mysql8013Lateral.supported, false);
assert.strictEqual(mysql8013Lateral.resolution, 'runtime-version');

var mysql8014 = sql.capabilityModel.qualify('mysql', { version: '8.0.14' });
var mysql8014Lateral = mysql8014.entries.find(function (entry) { return entry.path === 'queries.joins.lateral'; });
assert.ok(mysql8014Lateral);
assert.strictEqual(mysql8014Lateral.supported, true);
assert.strictEqual(mysql8014Lateral.resolution, 'runtime-version');
var pg = sql.capabilityModel.qualify('postgresql', { version: '18.0' });
assert.strictEqual(pg.dialect, 'postgresql');
assert.strictEqual(pg.version, '18.0');
assert.strictEqual(pg.summary.unresolved, 0);

(async function () {
  var client = sql.createClient({ dialect: 'sqlite', filename: ':memory:', pool: false });
  try {
    var live = await sql.capabilityModel.qualifyClient(client);
    assert.strictEqual(live.dialect, 'sqlite');
    assert.ok(/^\d+\.\d+/.test(live.version));
    assert.strictEqual(live.source, 'live-client');
    var liveJson = live.entries.find(function (entry) { return entry.path === 'expressions.json'; });
    assert.ok(liveJson);
    assert.strictEqual(typeof liveJson.supported === 'boolean' || liveJson.supported === null, true);
    assert.ok(live.summary.resolved > 0);
  } finally {
    await client.close();
  }
  console.log('NuBloxSQL Tier-1 runtime capability qualification contracts: PASS');
})().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});