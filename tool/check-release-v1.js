'use strict';

var fs = require('fs');
var path = require('path');

var root = path.resolve(__dirname, '..');
var failures = [];
var licenceMarker = 'NuBloxSQL Proprietary Software Licence';

function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
function json(file) { return JSON.parse(read(file)); }
function fail(message) { failures.push(message); }

var platform = json('package.json');
if (platform.name !== 'nubloxsql') fail('package.json must expose the nubloxsql package');
if (platform.version !== '1.0.0') fail('package.json must be version 1.0.0');
if (platform.private === true) fail('nubloxsql must remain publishable');
if (platform.license !== 'SEE LICENSE IN LICENSE') fail('package.json must point to the proprietary LICENSE');
if (platform.workspaces) fail('NuBloxSQL must not expose internal runtime modules as npm workspaces');

['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].forEach(function (key) {
  if (platform[key] && Object.keys(platform[key]).length) fail('nubloxsql must not declare ' + key);
});

if (fs.existsSync(path.join(root, 'packages'))) fail('legacy packages/ runtime tree must not exist');

[
  'lib/core/index.js',
  'lib/core/index.d.ts',
  'lib/dialects/mysql/index.js',
  'lib/dialects/mysql/index.d.ts',
  'lib/dialects/postgresql/index.js',
  'lib/dialects/postgresql/index.d.ts',
  'lib/dialects/sqlite/index.js',
  'lib/dialects/sqlite/index.d.ts'
].forEach(function (file) {
  if (!fs.existsSync(path.join(root, file))) fail('missing consolidated runtime file: ' + file);
});

['mysql', 'postgresql', 'sqlite'].forEach(function (dialect) {
  var runtimeRoot = path.join(root, 'lib', 'dialects', dialect);
  ['package.json', 'README.md', 'LICENSE', 'NOTICE'].forEach(function (file) {
    if (fs.existsSync(path.join(runtimeRoot, file))) fail('dialect runtime must not contain nested package metadata: lib/dialects/' + dialect + '/' + file);
  });
});
['package.json', 'README.md', 'LICENSE', 'NOTICE'].forEach(function (file) {
  if (fs.existsSync(path.join(root, 'lib', 'core', file))) fail('SQL Core runtime must not contain nested package metadata: lib/core/' + file);
});

if (read('LICENSE').indexOf(licenceMarker) === -1) fail('root LICENSE is not the NuBloxSQL proprietary licence');

[
  'docs/v1/SQL-CORE-V1-CONTRACT.md',
  'docs/v1/GATE-1-EVIDENCE.md',
  'docs/v1/GATE-3-EVIDENCE.md',
  'docs/v1/GATE-4-EVIDENCE.md',
  'docs/v1/V1-MIGRATION.md',
  'docs/v1/V1-SUPPORT-MATRIX.md',
  'docs/v1/V1-RELEASE-NOTES.md'
].forEach(function (file) {
  if (!fs.existsSync(path.join(root, file))) fail('missing release evidence/document: ' + file);
});

['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml'].forEach(function (file) {
  if (fs.existsSync(path.join(root, file))) fail('third-party dependency lockfile must not exist: ' + file);
});

var sqlCore = require(path.join(root, 'lib/core'));
if (sqlCore.CONTRACT_VERSION !== '1.0') fail('SQL Core CONTRACT_VERSION must be 1.0');

if (failures.length) {
  console.error('NuBloxSQL release architecture audit: FAILED');
  failures.forEach(function (failure) { console.error(' - ' + failure); });
  process.exitCode = 1;
} else {
  console.log('NuBloxSQL release architecture audit: PASS');
  console.log('One public package, one consolidated runtime tree, proprietary licence and zero third-party package dependencies are enforced.');
}
