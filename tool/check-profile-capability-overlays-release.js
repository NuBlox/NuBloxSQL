'use strict';

var assert = require('assert');
var sql = require('..');

assert.strictEqual(sql.PROFILE_CAPABILITY_OVERLAY_SCHEMA_VERSION, 1);
assert.strictEqual(sql.profileCapabilities.validate().valid, true);
assert.strictEqual(sql.profileCapabilities.validate().profiles, 100);
assert.strictEqual(sql.profileCapabilities.validate().officialOverlays, 1);

var exact = sql.profileCapabilities.status('postgresql', 'statements.select');
assert.strictEqual(exact.resolution, 'base-qualified');
assert.strictEqual(exact.available, true);

var inherited = sql.profileCapabilities.status('aurora-postgresql', 'statements.select');
assert.strictEqual(inherited.resolution, 'inherited-unverified');
assert.strictEqual(inherited.available, null);
assert.strictEqual(inherited.baseline.support, 'native');

var mariadb = sql.profileCapabilities.definition('mariadb');
assert.strictEqual(mariadb.baseDialect, 'mysql');
assert.strictEqual(mariadb.verification, 'documented');
assert.strictEqual(mariadb.changeCount, 12);

var mariaJson = sql.profileCapabilities.status('mariadb', 'types.json');
assert.strictEqual(mariaJson.resolution, 'overlay-documented');
assert.strictEqual(mariaJson.feature.nativeName, 'LONGTEXT COLLATE utf8mb4_bin');

var mariaSequence = sql.profileCapabilities.status('mariadb', 'statements.createSequence', { context: { version: '10.3' } });
assert.strictEqual(mariaSequence.resolution, 'overlay-documented');
assert.strictEqual(mariaSequence.feature.support, 'native');

var mariaCycle = sql.profileCapabilities.status('mariadb', 'queries.cte.cycle', { context: { version: '10.5.2' } });
assert.strictEqual(mariaCycle.resolution, 'overlay-documented');
assert.strictEqual(mariaCycle.feature.nativeName, 'CYCLE ... RESTRICT');

var mariaUuid = sql.profileCapabilities.status('mariadb', 'types.uuid', { context: { version: '10.7' } });
assert.strictEqual(mariaUuid.resolution, 'overlay-documented');
assert.strictEqual(mariaUuid.feature.support, 'native');

var mariaUpdateReturning = sql.profileCapabilities.status('mariadb', 'statements.updateReturning', { context: { version: '13.0' } });
assert.strictEqual(mariaUpdateReturning.resolution, 'overlay-documented');
assert.strictEqual(mariaUpdateReturning.feature.support, 'native');

var unavailable = sql.profileCapabilities.status('sqlserver', 'statements.select');
assert.strictEqual(unavailable.resolution, 'baseline-unavailable');
assert.strictEqual(unavailable.available, null);

var overlay = sql.profileCapabilities.compile('aurora-postgresql', {
  changes: [{
    path: 'extensions.__releaseQualification',
    operation: 'add',
    support: 'native',
    evidence: 'declared'
  }]
});
var added = sql.profileCapabilities.status('aurora-postgresql', 'extensions.__releaseQualification', { overlay: overlay });
assert.strictEqual(added.resolution, 'overlay-declared');
assert.strictEqual(added.available, true);

console.log('NuBloxSQL profile capability overlay release qualification: PASS');
