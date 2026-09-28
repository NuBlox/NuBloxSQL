'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var PACKAGE_ROOT = path.join(ROOT, 'packages');
var failures = [];
var PROPRIETARY_MARKER = 'NuBloxSQL Proprietary Software Licence';

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function isNuBloxPackage(name) { return name === 'nubloxsql' || name.indexOf('@nublox/') === 0; }
function inspectDependencyMap(file, section, map) {
  if (!map) return;
  Object.keys(map).sort().forEach(function (name) {
    if (!isNuBloxPackage(name)) failures.push(relative(file) + ': ' + section + ' contains third-party package ' + name + '@' + map[name]);
  });
}
function inspectPackage(file) {
  var manifest = readJson(file);
  inspectDependencyMap(file, 'dependencies', manifest.dependencies);
  inspectDependencyMap(file, 'devDependencies', manifest.devDependencies);
  inspectDependencyMap(file, 'optionalDependencies', manifest.optionalDependencies);
  inspectDependencyMap(file, 'peerDependencies', manifest.peerDependencies);
  if (manifest.nublox && (manifest.nublox.upstream || manifest.nublox.compatibilityLineage)) failures.push(relative(file) + ': contains upstream/compatibility lineage metadata');
  if (manifest.license !== 'SEE LICENSE IN LICENSE') failures.push(relative(file) + ': package must use SEE LICENSE IN LICENSE');
}
function walk(dir, visitor) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
    if (entry.name === 'node_modules' || entry.name === '.git') return;
    var full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, visitor);
    else visitor(full);
  });
}
function inspectLicence(file) {
  if (!fs.existsSync(file)) {
    failures.push(relative(file) + ': proprietary licence file is required');
    return;
  }
  var text = fs.readFileSync(file, 'utf8');
  if (text.indexOf(PROPRIETARY_MARKER) === -1) failures.push(relative(file) + ': does not contain the NuBloxSQL proprietary licence');
  if (/Apache License|Apache-2\.0/.test(text)) failures.push(relative(file) + ': current licence must not be Apache');
}

inspectPackage(path.join(ROOT, 'package.json'));
walk(PACKAGE_ROOT, function (file) { if (path.basename(file) === 'package.json') inspectPackage(file); });

if (fs.existsSync(path.join(PACKAGE_ROOT, 'mysql-cleanroom'))) failures.push('packages/mysql-cleanroom: transitional package must not exist after Gate 2 promotion');
var mysqlManifest = path.join(PACKAGE_ROOT, 'mysql', 'package.json');
if (!fs.existsSync(mysqlManifest) || readJson(mysqlManifest).name !== '@nublox/mysql') failures.push('packages/mysql/package.json: canonical @nublox/mysql package is required');

inspectLicence(path.join(ROOT, 'LICENSE'));
['mysql', 'sql-core', 'postgresql', 'sqlite'].forEach(function (name) { inspectLicence(path.join(PACKAGE_ROOT, name, 'LICENSE')); });

var forbiddenBasenames = new Set(['NUBLOX-UPSTREAM.json', 'NUBLOX-MASTERED-PACKAGE.md', 'THIRD_PARTY_NOTICES']);
walk(PACKAGE_ROOT, function (file) {
  if (forbiddenBasenames.has(path.basename(file))) {
    failures.push(relative(file) + ': inherited/third-party provenance marker must not exist in proprietary NuBloxSQL packages');
    return;
  }
  if (!/\.(?:js|mjs|cjs|ts|json|md|txt)$/i.test(file)) return;
  var text = fs.readFileSync(file, 'utf8');
  ['mysqljs/mysql', 'NuBlox Mastered Package', 'compatibilityLineage'].forEach(function (marker) {
    if (text.indexOf(marker) !== -1) failures.push(relative(file) + ': contains prohibited lineage marker "' + marker + '"');
  });
  if ((path.basename(file) === 'NOTICE' || path.basename(file) === 'LICENSE') && /Apache License|Apache-2\.0/.test(text)) {
    failures.push(relative(file) + ': current package contains an Apache licence marker');
  }
});

['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml'].forEach(function (file) {
  if (fs.existsSync(path.join(ROOT, file))) failures.push(file + ': dependency lockfile must not exist in the zero-third-party release boundary');
});

if (failures.length) {
  console.error('NuBloxSQL proprietary boundary audit: FAILED');
  failures.forEach(function (failure) { console.error(' - ' + failure); });
  console.error('\n' + failures.length + ' blocker(s) remain. Proprietary release is not permitted.');
  process.exitCode = 1;
} else {
  console.log('NuBloxSQL proprietary boundary audit: PASS');
  console.log('No declared third-party package dependencies, known inherited-source markers, or current Apache licence markers were found in the package boundary.');
}
