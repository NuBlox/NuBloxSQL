'use strict';

// Internal directory changes must not alter the published driver API.
// This deliberately checks the packaged release evidence as well as the source.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const sql = require('..');
const release = require('../docs/releases/public-api-v1.json');
const pkg = require('../package.json');

const admin = [
  'DatabaseBootstrapPlanner','DatabaseBootstrapExecutor','DatabaseConfiguration',
  'DatabaseConfigurationPlanner','DatabaseConfigurationExecutor'
];
const engineering = [
  'SchemaSnapshot','SchemaDiff','MigrationPlanner','MigrationExecutor',
  'DataMovement','DataMovementPlanner','DependencyGraph','ObjectIdentity'
];
const catalog = ['DatabaseTechnologyRegistry','CloudDatabaseRegistry'];
const checks = [
  ...admin.map(name => ['lib/client/' + name + '.js', 'lib/client/administration/' + name + '.js']),
  ...engineering.map(name => ['lib/client/' + name + '.js', 'lib/client/engineering/' + name + '.js']),
  ...catalog.map(name => ['lib/capabilities/' + name + '.js', 'lib/catalog/' + name + '.js'])
];
assert.ok(pkg.files.includes('lib/client/'), 'client submodules must ship in npm package');
assert.ok(pkg.files.includes('lib/catalog/'), 'catalogue submodules must ship in npm package');
for (const [former, current] of checks) {
  assert.equal(fs.existsSync(path.join(root, former)), false,
    'stale source path should not reappear: ' + former);
  assert.ok(fs.statSync(path.join(root, current)).isFile(), 'missing module: ' + current);
  assert.ok(release.requiredPackageFiles.includes(current),
    'required package evidence must track move: ' + current);
  assert.ok(!release.requiredPackageFiles.includes(former),
    'former module path must be removed from package evidence: ' + former);
}
assert.strictEqual(sql.databaseTechnologyRegistry,
  require('../lib/catalog/DatabaseTechnologyRegistry'));
assert.strictEqual(sql.cloudDatabaseRegistry,
  require('../lib/catalog/CloudDatabaseRegistry'));

const exportsToCheck = [
  'planDatabaseBootstrap','executeDatabaseBootstrap',
  'discoverDatabaseConfiguration','planDatabaseConfiguration',
  'executeDatabaseConfiguration','buildSchemaSnapshot','diffSchemas',
  'planMigration','executeMigration','moveData','planDataMovement',
  'buildDependencyGraph','objectId'
];
for (const name of exportsToCheck) {
  assert.equal(typeof sql[name], 'function', 'public API lost: ' + name);
  assert.ok(release.exports.includes(name), 'release manifest lost: ' + name);
}
assert.equal(sql.databaseTechnologyRegistry.validate().valid, true);
assert.equal(sql.cloudDatabaseRegistry.validate().valid, true);

const migrated = new Set(checks.map(pair => pair[0]));
const trackedTexts = [
  'index.js','lib/client/Client.js','lib/client/MetadataIntegration.js',
  'lib/client/StructureTree.js',
  'lib/client/discovery/DatabaseServerDiscovery.js',
  'lib/capabilities/ProductCoverage.js',
  'docs/releases/public-api-v1.json','docs/releases/tier1-stable-evidence.json',
  'test/plan-integrity-hardening.js'
];
for (const file of trackedTexts) {
  const content = fs.readFileSync(path.join(root, file),'utf8');
  for (const former of migrated) {
    assert.ok(!content.includes(former.replace(/\.js$/, '')),
      'stale reference to moved module in ' + file + ': ' + former);
  }
}
console.log('NuBloxSQL catalogue, administration and engineering module boundaries: PASS');
