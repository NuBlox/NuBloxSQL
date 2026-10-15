'use strict';

// Refactoring invariant: move implementation behind the public API, not the API itself.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const driver = require('..');
const released = require('../docs/releases/public-api-v1.json');
const pkg = require('../package.json');

const cases = [
  ['DatabaseServerDiscovery', 'discoverDatabaseServer', 'discoverServer'],
  ['DatabaseSecurityDiscovery', 'discoverDatabaseSecurity', 'discoverSecurity'],
  ['DatabaseNativeJobDiscovery', 'discoverNativeDatabaseJobs', 'discoverNativeJobs']
];

assert.ok(pkg.files.includes('lib/client/'), 'package must include grouped driver modules');
for (const [moduleName, publicName, clientName] of cases) {
  const oldPath = 'lib/client/' + moduleName + '.js';
  const grouped = 'lib/client/discovery/' + moduleName + '.js';
  assert.equal(fs.existsSync(path.join(root, oldPath)), false,
    'flattened discovery module should not reappear: ' + oldPath);
  assert.equal(fs.statSync(path.join(root, grouped)).isFile(), true, grouped);
  assert.ok(released.requiredPackageFiles.includes(grouped), grouped + ' must be packaged');
  assert.ok(!released.requiredPackageFiles.includes(oldPath),
    oldPath + ' is no longer part of package evidence');
  const impl = require(path.join(root, grouped));
  assert.equal(typeof impl.discover, 'function');
  assert.strictEqual(driver[publicName], impl.discover,
    publicName + ' must resolve to the grouped implementation');
  assert.equal(typeof driver.Client.prototype[clientName], 'function',
    clientName + ' must remain on the public Client interface');
}

const server = require('../lib/client/discovery/DatabaseServerDiscovery');
assert.strictEqual(driver.assessDatabaseBootstrapPrerequisites, server.assessBootstrapPrerequisites);
assert.equal(driver.DATABASE_SERVER_DISCOVERY_SCHEMA_VERSION, server.SCHEMA_VERSION);
assert.equal(driver.DATABASE_BOOTSTRAP_PREREQUISITE_SCHEMA_VERSION, server.PREREQUISITE_SCHEMA_VERSION);
assert.equal(driver.DATABASE_SECURITY_DISCOVERY_SCHEMA_VERSION,
  require('../lib/client/discovery/DatabaseSecurityDiscovery').SCHEMA_VERSION);
assert.equal(driver.NATIVE_DATABASE_JOB_DISCOVERY_SCHEMA_VERSION,
  require('../lib/client/discovery/DatabaseNativeJobDiscovery').SCHEMA_VERSION);

// The packaged module tree, not a deep import into an application, owns discovery.
const entry = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'lib/client/Client.js'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'lib/jobs/ServerDiscoveryJobAdapter.js'), 'utf8');
for (const [moduleName] of cases) {
  assert.ok(entry.includes('/discovery/' + moduleName), moduleName);
  assert.ok(client.includes('./discovery/' + moduleName), moduleName);
}
assert.ok(worker.includes('../client/discovery/DatabaseServerDiscovery'));
// Vendor-specific metadata inspection implementations belong to discovery,
// not the flat client root. Both remain internal and packaged via lib/client/.
for (const name of ['MySQLSecurityMetadataIntegration','SqlServerMetadataIntegration']) {
  const grouped='lib/client/discovery/'+name+'.js';
  assert.equal(fs.existsSync(path.join(root,'lib/client/'+name+'.js')),false);
  assert.equal(fs.statSync(path.join(root,grouped)).isFile(),true);
  assert.equal(typeof require(path.join(root,grouped)).install,'function');
}
assert.ok(fs.readFileSync(path.join(root,'lib/client/MetadataIntegration.js'),'utf8')
  .includes('./discovery/MySQLSecurityMetadataIntegration'));
assert.ok(entry.includes('./lib/client/discovery/SqlServerMetadataIntegration'));
console.log('NuBloxSQL grouped driver discovery imports and public API: PASS');
