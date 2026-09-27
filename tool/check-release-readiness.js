'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var packageJson = require('../package.json');
var upstreamMetadata = require('../NUBLOX-UPSTREAM.json');

var root = path.resolve(__dirname, '..');
var requiredFiles = [
  'index.js',
  'index.mjs',
  'index.d.ts',
  'promise.js',
  'promise.mjs',
  'promise.d.ts',
  'Readme.md',
  'Changes.md',
  'LICENSE',
  'NOTICE',
  'THIRD_PARTY_NOTICES',
  'NUBLOX-MASTERED-PACKAGE.md',
  'NUBLOX-MYSQL-ROADMAP.md',
  'NUBLOX-UPSTREAM.json',
  'compatibility/mysql2.json',
  'docs/architecture/query-pipelining.md',
  'docs/releases/3.1.0-rc.1.md'
];

assert.strictEqual(packageJson.name, '@nublox/mysql');
assert.match(packageJson.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
assert.notStrictEqual(packageJson.private, true);
assert.strictEqual(packageJson.license, 'Apache-2.0');
assert.strictEqual(packageJson.author, 'Stephen J T Spittal');
assert.strictEqual(packageJson.engines.node, '>=22');
assert.ok(packageJson.exports['.']);
assert.ok(packageJson.exports['./promise']);
assert.strictEqual(packageJson.exports['./package.json'], './package.json');
assert.ok(packageJson.files.indexOf('lib/') !== -1);
assert.ok(packageJson.files.indexOf('compatibility/') !== -1);
assert.ok(packageJson.files.indexOf('docs/') !== -1);
assert.ok(packageJson.files.indexOf('LICENSE') !== -1);
assert.ok(packageJson.files.indexOf('NOTICE') !== -1);
assert.ok(packageJson.files.indexOf('THIRD_PARTY_NOTICES') !== -1);
assert.strictEqual(upstreamMetadata.nubloxPackage, packageJson.name);
assert.strictEqual(upstreamMetadata.nubloxVersion, packageJson.version);
assert.strictEqual(upstreamMetadata.nubloxLicense, 'Apache-2.0');
assert.strictEqual(upstreamMetadata.upstreamLicense, 'MIT');

requiredFiles.forEach(function (file) {
  assert.ok(fs.existsSync(path.join(root, file)), 'missing release file: ' + file);
});

assertPinned(packageJson.dependencies, 'dependency');
assertPinned(packageJson.devDependencies, 'devDependency');

process.stdout.write(
  'release readiness: ' + packageJson.name + '@' + packageJson.version + ' package metadata and required files verified\n'
);

function assertPinned(dependencies, label) {
  Object.keys(dependencies || {}).forEach(function (name) {
    var version = dependencies[name];
    assert.match(
      version,
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
      label + ' must use an exact version: ' + name + '@' + version
    );
  });
}
