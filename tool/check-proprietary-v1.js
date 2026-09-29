'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var RUNTIME_ROOT = path.join(ROOT, 'lib');
var failures = [];
var PROPRIETARY_MARKER = 'NuBloxSQL Proprietary Software Licence';

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function inspectDependencyMap(file, section, map) {
  if (!map) return;
  Object.keys(map).sort().forEach(function (name) {
    failures.push(relative(file) + ': ' + section + ' contains package dependency ' + name + '@' + map[name]);
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
inspectLicence(path.join(ROOT, 'LICENSE'));

if (fs.existsSync(path.join(ROOT, 'packages'))) failures.push('packages/: legacy multi-package runtime tree must not exist');
if (!fs.existsSync(RUNTIME_ROOT)) failures.push('lib/: consolidated runtime tree is required');

var forbiddenBasenames = new Set(['NUBLOX-UPSTREAM.json', 'NUBLOX-MASTERED-PACKAGE.md', 'THIRD_PARTY_NOTICES']);
walk(RUNTIME_ROOT, function (file) {
  if (forbiddenBasenames.has(path.basename(file))) {
    failures.push(relative(file) + ': inherited/third-party provenance marker must not exist in proprietary NuBloxSQL runtime');
    return;
  }
  if (path.basename(file) === 'package.json') failures.push(relative(file) + ': nested package manifests are not permitted in the NuBloxSQL runtime tree');
  if (!/\.(?:js|mjs|cjs|ts|json|md|txt)$/i.test(file)) return;
  var text = fs.readFileSync(file, 'utf8');
  ['mysqljs/mysql', 'NuBlox Mastered Package', 'compatibilityLineage'].forEach(function (marker) {
    if (text.indexOf(marker) !== -1) failures.push(relative(file) + ': contains prohibited lineage marker "' + marker + '"');
  });
  if ((path.basename(file) === 'NOTICE' || path.basename(file) === 'LICENSE') && /Apache License|Apache-2\.0/.test(text)) {
    failures.push(relative(file) + ': runtime contains an Apache licence marker');
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
  console.log('The consolidated runtime contains no declared package dependencies, nested package manifests, inherited-source markers, or Apache licence markers.');
}
