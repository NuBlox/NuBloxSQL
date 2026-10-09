'use strict';

var fs = require('fs');
var path = require('path');

var root = path.resolve(__dirname, '..');
var manifestPath = path.join(root, 'docs/releases/tier1-stable-evidence.json');
var manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
var failures = [];

function fail(message) { failures.push(message); }
function exists(relativePath) { return fs.existsSync(path.join(root, relativePath)); }
function requireFile(relativePath, label) {
  if (!exists(relativePath)) fail((label || 'required evidence') + ' is missing: ' + relativePath);
}

if (manifest.schemaVersion !== 1) fail('unsupported Tier-1 evidence schemaVersion: ' + manifest.schemaVersion);
if (!Array.isArray(manifest.node) || manifest.node.join(',') !== '22,24,26') fail('Tier-1 Node qualification matrix must be exactly 22,24,26');

Object.keys(manifest.dialects || {}).forEach(function (dialect) {
  var entry = manifest.dialects[dialect];
  if (!entry || typeof entry !== 'object') return fail('invalid dialect evidence entry: ' + dialect);
  if (!Array.isArray(entry.requiredFiles) || entry.requiredFiles.length === 0) fail(dialect + ' must declare requiredFiles');
  else entry.requiredFiles.forEach(function (file) { requireFile(file, dialect + ' required evidence'); });

  if (entry.status !== 'qualified') fail(dialect + ' Tier-1 evidence is not qualified: ' + String(entry.status || 'missing status'));
  if (Array.isArray(entry.pendingRequiredFiles) && entry.pendingRequiredFiles.length) {
    fail(dialect + ' still declares pendingRequiredFiles: ' + entry.pendingRequiredFiles.join(', '));
  }
});

(manifest.sharedRequiredFiles || []).forEach(function (file) { requireFile(file, 'shared Tier-1 evidence'); });

['postgresql', 'mysql', 'sqlite'].forEach(function (dialect) {
  if (!manifest.dialects || !manifest.dialects[dialect]) fail(dialect + ' Tier-1 evidence entry is required');
});

if (failures.length) {
  console.error('NuBloxSQL Tier-1 evidence qualification: FAILED');
  failures.forEach(function (failure) { console.error(' - ' + failure); });
  process.exitCode = 1;
} else {
  console.log('NuBloxSQL Tier-1 evidence qualification: PASS');
  console.log('All Tier-1 dialects are qualified and all referenced repository evidence exists.');
}
