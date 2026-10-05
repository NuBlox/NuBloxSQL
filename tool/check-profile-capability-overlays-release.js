'use strict';

var assert = require('assert');
var sql = require('..');

assert.strictEqual(sql.PROFILE_CAPABILITY_OVERLAY_SCHEMA_VERSION, 1);
assert.strictEqual(sql.profileCapabilities.validate().valid, true);
assert.strictEqual(sql.profileCapabilities.validate().profiles, 100);

var exact = sql.profileCapabilities.status('postgresql', 'statements.select');
assert.strictEqual(exact.resolution, 'base-qualified');
assert.strictEqual(exact.available, true);

var inherited = sql.profileCapabilities.status('aurora-postgresql', 'statements.select');
assert.strictEqual(inherited.resolution, 'inherited-unverified');
assert.strictEqual(inherited.available, null);
assert.strictEqual(inherited.baseline.support, 'native');

var mariadb = sql.profileCapabilities.definition('mariadb');
assert.strictEqual(mariadb.baseDialect, 'mysql');

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
