'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var PACKAGE_ROOT = path.join(ROOT, 'packages');
var failures = [];

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function isNuBloxPackage(name) {
  return name === 'nubloxsql' || name.indexOf('@nublox/') === 0;
}

function inspectDependencyMap(file, section, map) {
  if (!map) return;
  Object.keys(map).sort().forEach(function (name) {
    if (!isNuBloxPackage(name)) {
      failures.push(relative(file) + ': ' + section + ' contains third-party package ' + name + '@' + map[name]);
    }
  });
}

function inspectPackage(file) {
  var manifest = readJson(file);
  inspectDependencyMap(file, 'dependencies', manifest.dependencies);
  inspectDependencyMap(file, 'devDependencies', manifest.devDependencies);
  inspectDependencyMap(file, 'optionalDependencies', manifest.optionalDependencies);
  inspectDependencyMap(file, 'peerDependencies', manifest.peerDependencies);

  if (manifest.nublox && (manifest.nublox.upstream || manifest.nublox.compatibilityLineage)) {
    failures.push(relative(file) + ': contains upstream/compatibility lineage metadata');
  }
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

inspectPackage(path.join(ROOT, 'package.json'));
walk(PACKAGE_ROOT, function (file) {
  if (path.basename(file) === 'package.json') inspectPackage(file);
});

var forbiddenBasenames = new Set([
  'NUBLOX-UPSTREAM.json',
  'NUBLOX-MASTERED-PACKAGE.md',
  'THIRD_PARTY_NOTICES'
]);

walk(ROOT, function (file) {
  if (forbiddenBasenames.has(path.basename(file))) {
    failures.push(relative(file) + ': inherited/third-party provenance marker must not exist in proprietary v1');
    return;
  }

  if (!/\.(?:js|mjs|cjs|ts|json|md|txt)$/i.test(file)) return;
  var text = fs.readFileSync(file, 'utf8');
  var markers = [
    'mysqljs/mysql',
    'NuBlox Mastered Package',
    'compatibilityLineage'
  ];
  markers.forEach(function (marker) {
    if (text.indexOf(marker) !== -1) {
      failures.push(relative(file) + ': contains prohibited lineage marker "' + marker + '"');
    }
  });
});

if (failures.length) {
  console.error('NuBloxSQL proprietary v1 audit: FAILED');
  failures.forEach(function (failure) { console.error(' - ' + failure); });
  console.error('\n' + failures.length + ' blocker(s) remain. v1.0.0 proprietary release is not permitted.');
  process.exitCode = 1;
} else {
  console.log('NuBloxSQL proprietary v1 audit: PASS');
  console.log('No declared third-party package dependencies or known inherited-source markers were found.');
}
