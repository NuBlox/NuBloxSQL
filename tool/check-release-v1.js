'use strict';

var fs = require('fs');
var path = require('path');

var root = path.resolve(__dirname, '..');
var failures = [];
var internal = [
  ['packages/mysql/package.json', '@nublox/mysql', '1.0.0'],
  ['packages/sql-core/package.json', '@nublox/sql-core', '1.0.0'],
  ['packages/postgresql/package.json', '@nublox/postgresql', '1.0.0'],
  ['packages/sqlite/package.json', '@nublox/sqlite', '0.1.0']
];
var licenceMarker = 'NuBloxSQL Proprietary Software Licence';

function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
function json(file) { return JSON.parse(read(file)); }
function fail(message) { failures.push(message); }

var platform = json('package.json');
if (platform.name !== 'nubloxsql') fail('package.json must expose the nubloxsql package');
if (platform.version !== '1.0.0') fail('package.json must be version 1.0.0');
if (platform.private === true) fail('nubloxsql must remain publishable');
if (platform.license !== 'SEE LICENSE IN LICENSE') fail('package.json must point to the proprietary LICENSE');

if (read('LICENSE').indexOf(licenceMarker) === -1) fail('root LICENSE is not the NuBloxSQL proprietary licence');

internal.forEach(function (entry) {
  var file = entry[0];
  var name = entry[1];
  var version = entry[2];
  var manifest = json(file);
  if (manifest.name !== name) fail(file + ' has unexpected workspace name');
  if (manifest.version !== version) fail(name + ' has unexpected internal version');
  if (manifest.private !== true) fail(name + ' must remain an internal/private NuBloxSQL workspace');
  ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].forEach(function (key) {
    if (manifest[key] && Object.keys(manifest[key]).length) fail(name + ' must not declare ' + key);
  });
});

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

var sqlCore = require(path.join(root, 'packages/sql-core'));
if (sqlCore.CONTRACT_VERSION !== '1.0') fail('SQL Core CONTRACT_VERSION must be 1.0');

if (failures.length) {
  console.error('NuBloxSQL release architecture audit: FAILED');
  failures.forEach(function (failure) { console.error(' - ' + failure); });
  process.exitCode = 1;
} else {
  console.log('NuBloxSQL release architecture audit: PASS');
  console.log('One public package surface, private internal dialect workspaces, proprietary licence and zero third-party package dependencies are enforced.');
}
