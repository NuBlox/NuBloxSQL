'use strict';

var assert = require('assert');
var sql = require('..');

assert.strictEqual(sql.PROFILE_CAPABILITY_OVERLAY_SCHEMA_VERSION, 1);
assert.strictEqual(sql.capabilityModel.profileCapabilities, sql.profileCapabilities);
assert.deepStrictEqual(Array.from(sql.PROFILE_CAPABILITY_CHANGE_TYPES), ['add','override','remove']);
assert.ok(sql.PROFILE_CAPABILITY_RESOLUTIONS.indexOf('inherited-unverified') >= 0);

var validation = sql.profileCapabilities.validate();
assert.strictEqual(validation.valid, true, validation.errors.join('\n'));
assert.strictEqual(validation.profiles, 100);
assert.strictEqual(validation.officialOverlays, 0);

var postgresql = sql.profileCapabilities.definition('postgresql');
assert.strictEqual(postgresql.baseDialect, 'postgresql');
assert.strictEqual(postgresql.verification, 'base-qualified');

var pgSelect = sql.profileCapabilities.status('postgresql', 'statements.select');
assert.strictEqual(pgSelect.resolution, 'base-qualified');
assert.strictEqual(pgSelect.available, true);
assert.strictEqual(pgSelect.feature.support, 'native');

var aurora = sql.profileCapabilities.definition('aurora-postgresql');
assert.strictEqual(aurora.canonicalDialect, 'postgresql');
assert.strictEqual(aurora.baseDialect, 'postgresql');
assert.strictEqual(aurora.verification, 'inherited-unverified');

var inherited = sql.profileCapabilities.status('aurora-postgresql', 'statements.select');
assert.strictEqual(inherited.resolution, 'inherited-unverified');
assert.strictEqual(inherited.available, null);
assert.strictEqual(inherited.feature, null);
assert.strictEqual(inherited.baseline.support, 'native');
assert.strictEqual(sql.profileCapabilities.supports('aurora-postgresql', 'statements.select'), null);

var mariadb = sql.profileCapabilities.definition('mariadb');
assert.strictEqual(mariadb.canonicalDialect, 'mariadb');
assert.strictEqual(mariadb.baseDialect, 'mysql');
assert.deepStrictEqual(Array.from(mariadb.inheritance), ['mariadb','mysql']);

var cockroach = sql.profileCapabilities.definition('cockroachdb');
assert.strictEqual(cockroach.canonicalDialect, 'cockroachdb');
assert.strictEqual(cockroach.baseDialect, 'postgresql');

var sqlserver = sql.profileCapabilities.definition('sqlserver');
assert.strictEqual(sqlserver.baseDialect, null);
assert.strictEqual(sqlserver.verification, 'baseline-unavailable');
var sqlserverSelect = sql.profileCapabilities.status('sqlserver', 'statements.select');
assert.strictEqual(sqlserverSelect.resolution, 'baseline-unavailable');
assert.strictEqual(sqlserverSelect.available, null);

var overlay = sql.profileCapabilities.compile('aurora-postgresql', {
  verification: 'contract-test',
  evidence: ['synthetic contract overlay only'],
  changes: [
    {
      path: 'extensions.__overlayContractTest',
      operation: 'add',
      support: 'native',
      evidence: 'declared',
      notes: 'Synthetic test-only profile capability.'
    },
    {
      path: 'queries.cte.search',
      operation: 'remove',
      evidence: 'documented',
      references: ['contract:test']
    },
    {
      path: 'statements.merge',
      operation: 'override',
      support: 'unsupported',
      evidence: 'qualified',
      since: '99.0',
      notes: 'Synthetic version-gated contract change.'
    },
    {
      path: 'statements.merge',
      operation: 'override',
      support: 'partial',
      evidence: 'qualified',
      deployments: ['serverless'],
      notes: 'Synthetic deployment-gated contract change.'
    }
  ]
});

var added = sql.profileCapabilities.status('aurora-postgresql', 'extensions.__overlayContractTest', { overlay: overlay });
assert.strictEqual(added.resolution, 'overlay-declared');
assert.strictEqual(added.available, true);
assert.strictEqual(added.feature.support, 'native');

var removed = sql.profileCapabilities.status('aurora-postgresql', 'queries.cte.search', { overlay: overlay });
assert.strictEqual(removed.resolution, 'overlay-documented');
assert.strictEqual(removed.available, false);
assert.strictEqual(removed.feature.support, 'unsupported');

var versionUnknown = sql.profileCapabilities.status('aurora-postgresql', 'statements.merge', { overlay: overlay });
assert.strictEqual(versionUnknown.resolution, 'inherited-unverified');
assert.strictEqual(versionUnknown.available, null);

var versionBelow = sql.profileCapabilities.status('aurora-postgresql', 'statements.merge', {
  overlay: overlay,
  context: { version: '18.0' }
});
assert.strictEqual(versionBelow.resolution, 'inherited-unverified');

var versionQualified = sql.profileCapabilities.status('aurora-postgresql', 'statements.merge', {
  overlay: overlay,
  context: { version: '99.0' }
});
assert.strictEqual(versionQualified.resolution, 'overlay-qualified');
assert.strictEqual(versionQualified.feature.support, 'unsupported');

var deploymentUnknown = sql.profileCapabilities.status('aurora-postgresql', 'statements.merge', {
  overlay: overlay,
  context: { version: '18.0' }
});
assert.strictEqual(deploymentUnknown.resolution, 'inherited-unverified');

var deploymentQualified = sql.profileCapabilities.status('aurora-postgresql', 'statements.merge', {
  overlay: overlay,
  context: { version: '18.0', deployment: 'serverless' }
});
assert.strictEqual(deploymentQualified.resolution, 'overlay-qualified');
assert.strictEqual(deploymentQualified.feature.support, 'partial');

var diff = sql.profileCapabilities.diff('aurora-postgresql', { overlay: overlay });
assert.strictEqual(diff.changes.length, 4);

var report = sql.profileCapabilities.report('aurora-postgresql', { overlay: overlay });
assert.ok(report.summary.total > 100);
assert.strictEqual(report.summary.overlayDeclared, 1);
assert.ok(report.summary.inheritedUnverified > 0);

assert.throws(function () {
  sql.profileCapabilities.compile('aurora-postgresql', {
    changes: [{ path: 'statements.select', operation: 'add', support: 'native' }]
  });
}, /existing baseline capability/);

assert.throws(function () {
  sql.profileCapabilities.compile('aurora-postgresql', {
    changes: [{ path: 'extensions.__missingOverride', operation: 'override', support: 'native' }]
  });
}, /missing baseline capability/);

assert.throws(function () {
  sql.profileCapabilities.compile('not-a-product', { changes: [] });
}, /Unknown dialect\/DBMS profile/);

console.log('NuBloxSQL dialect/profile capability overlay contract: PASS');
