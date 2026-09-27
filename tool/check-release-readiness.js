'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var packageJson = require('../package.json');

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
  'License',
  'NUBLOX-MASTERED-PACKAGE.md',
  'NUBLOX-MYSQL-ROADMAP.md',
  'NUBLOX-UPSTREAM.json',
  'compatibility/manifest.json',
  'docs/architecture/query-pipelining.md'
];

assert.strictEqual(packageJson.name, '@nublox/mysql');
assert.match(packageJson.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
assert.notStrictEqual(packageJson.private, true);
assert.strictEqual(packageJson.engines.node, '>=22');
assert.ok(packageJson.exports['.']);
assert.ok(packageJson.exports['./promise']);
assert.strictEqual(packageJson.exports['./package.json'], './package.json');
assert.ok(packageJson.files.indexOf('lib/') !== -1);
assert.ok(packageJson.files.indexOf('compatibility/') !== -1);
assert.ok(packageJson.files.indexOf('docs/') !== -1);

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
