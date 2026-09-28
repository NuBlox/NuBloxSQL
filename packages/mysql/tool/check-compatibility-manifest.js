'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var packageRoot = path.resolve(__dirname, '..');
var repositoryRoot = path.resolve(packageRoot, '../..');
var manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'compatibility/mysql2.json'), 'utf8'));
var packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
var seen = Object.create(null);

function evidenceExists(relativePath) {
  return fs.existsSync(path.join(packageRoot, relativePath))
    || fs.existsSync(path.join(repositoryRoot, relativePath));
}

assert.strictEqual(manifest.reference.package, 'mysql2');
assert.ok(manifest.reference.version);
assert.ok(Array.isArray(manifest.statuses));
assert.ok(Array.isArray(manifest.capabilities));
assert.ok(manifest.capabilities.length > 0);

if (packageJson.devDependencies && packageJson.devDependencies.mysql2) {
  assert.strictEqual(
    packageJson.devDependencies.mysql2,
    manifest.reference.version,
    'mysql2 devDependency must match the compatibility reference version'
  );
}

manifest.capabilities.forEach(function (capability) {
  assert.ok(capability.id, 'capability id is required');
  assert.strictEqual(seen[capability.id], undefined, 'duplicate capability id: ' + capability.id);
  assert.ok(manifest.statuses.indexOf(capability.status) !== -1, 'invalid status: ' + capability.status);
  assert.ok(capability.milestone, 'milestone is required for: ' + capability.id);
  assert.ok(Array.isArray(capability.evidence), 'evidence must be an array for: ' + capability.id);

  if (capability.status === 'supported') {
    assert.ok(capability.evidence.length > 0, 'supported capability needs evidence: ' + capability.id);
  }

  capability.evidence.forEach(function (relativePath) {
    assert.ok(
      evidenceExists(relativePath),
      'missing compatibility evidence for ' + capability.id + ': ' + relativePath
    );
  });

  seen[capability.id] = true;
});
