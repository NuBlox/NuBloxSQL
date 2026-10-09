'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var root = path.resolve(__dirname, '..');
var sql = require(root);

var definitionPath = path.join(root, 'docs/strategy/PRODUCT-DEFINITION.md');
var visionPath = path.join(root, 'docs/strategy/PRODUCT-VISION.md');
var lifecyclePath = path.join(root, 'docs/releases/product-lifecycle-v2.json');

assert(fs.existsSync(definitionPath), 'canonical product definition is missing');
assert(fs.existsSync(visionPath), 'product vision is missing');
assert(fs.existsSync(lifecyclePath), 'machine-readable product lifecycle is missing');

var definition = fs.readFileSync(definitionPath, 'utf8');
var vision = fs.readFileSync(visionPath, 'utf8');
var lifecycle = JSON.parse(fs.readFileSync(lifecyclePath, 'utf8'));

assert(definition.includes('one API for the complete SQL database lifecycle'), 'canonical lifecycle promise missing');
assert(definition.includes('One developer API, honest dialect semantics.'), 'governing design rule missing');
assert(definition.includes('## Infrastructure boundary'), 'infrastructure boundary missing');
assert(definition.includes('## Product decision gate'), 'product decision gate missing');
assert(vision.includes('Select') && vision.includes('Install') && vision.includes('Initialize') && vision.includes('Discover') && vision.includes('Retire'), 'vision must span the complete end-to-end lifecycle');

assert.strictEqual(lifecycle.schemaVersion, 2);
assert.deepStrictEqual(lifecycle.supportedEngines, ['postgresql','mysql','sqlite','sqlserver']);
assert.strictEqual(lifecycle.phases.length, 11);
assert.deepStrictEqual(
  lifecycle.phases.map(function (entry) { return entry.id; }),
  ['select','install','initialize','discover','establish','build','use','understand','operate','change','retire']
);
assert.strictEqual(lifecycle.domains.length, 8);
assert.deepStrictEqual(
  lifecycle.domains.map(function (entry) { return entry.id; }),
  ['engine-lifecycle','runtime','language','intelligence','engineering','administration','operations','portability-governance']
);

[
  'lifecycle.installation',
  'lifecycle.initialization',
  'lifecycle.engine-upgrade',
  'administration.bootstrap',
  'administration.configuration',
  'administration.security',
  'operations.health-sessions',
  'operations.maintenance',
  'operations.backup-recovery',
  'operations.replication-ha',
  'operations.capacity-storage',
  'operations.upgrade-readiness',
  'lifecycle.retirement'
].forEach(function (id) {
  assert(sql.productCoverage.area(id), 'complete-lifecycle coverage area missing: ' + id);
});

[
  'lifecycle.installation',
  'lifecycle.initialization',
  'lifecycle.engine-upgrade',
  'administration.bootstrap',
  'administration.configuration',
  'administration.security',
  'operations.backup-recovery',
  'operations.replication-ha',
  'operations.capacity-storage',
  'operations.upgrade-readiness',
  'lifecycle.retirement'
].forEach(function (id) {
  assert(sql.productCoverage.gaps().some(function (area) { return area.id === id; }), 'expected lifecycle gap missing: ' + id);
});

console.log('NuBloxSQL canonical product definition and lifecycle qualification: PASS');
