'use strict';

var fs = require('fs');
var path = require('path');

var root = path.resolve(__dirname, '..');
var failures = [];
var licenceMarker = 'NuBloxSQL Proprietary Software Licence';

function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
function json(file) { return JSON.parse(read(file)); }
function fail(message) { failures.push(message); }
function exists(file) { return fs.existsSync(path.join(root, file)); }

var platform = json('package.json');
if (platform.name !== 'nubloxsql') fail('package.json must expose the nubloxsql package');
if (!/^1\.\d+\.\d+$/.test(platform.version)) fail('package.json must expose a stable NuBloxSQL 1.x version');
if (platform.private === true) fail('nubloxsql must remain publishable');
if (platform.license !== 'SEE LICENSE IN LICENSE') fail('package.json must point to the proprietary LICENSE');
if (!platform.publishConfig || platform.publishConfig.access !== 'public') fail('nubloxsql publishConfig.access must be public');
if (platform.workspaces) fail('NuBloxSQL must not expose internal runtime modules as npm workspaces');

['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].forEach(function (key) {
  if (platform[key] && Object.keys(platform[key]).length) fail('nubloxsql must not declare ' + key);
});

if (exists('packages')) fail('legacy packages/ runtime tree must not exist');

[
  'lib/core/index.js',
  'lib/core/index.d.ts',
  'lib/dialects/mysql/index.js',
  'lib/dialects/mysql/index.d.ts',
  'lib/dialects/postgresql/index.js',
  'lib/dialects/postgresql/index.d.ts',
  'lib/dialects/sqlite/index.js',
  'lib/dialects/sqlite/index.d.ts',
  'lib/dialects/sqlserver/index.js',
  'lib/dialects/sqlserver/index.d.ts'
].forEach(function (file) {
  if (!exists(file)) fail('missing consolidated runtime file: ' + file);
});

['mysql', 'postgresql', 'sqlite', 'sqlserver'].forEach(function (dialect) {
  var runtimeRoot = path.join(root, 'lib', 'dialects', dialect);
  ['package.json', 'README.md', 'LICENSE', 'NOTICE'].forEach(function (file) {
    if (fs.existsSync(path.join(runtimeRoot, file))) fail('dialect runtime must not contain nested package metadata: lib/dialects/' + dialect + '/' + file);
  });
});
['package.json', 'README.md', 'LICENSE', 'NOTICE'].forEach(function (file) {
  if (exists(path.join('lib', 'core', file))) fail('SQL Core runtime must not contain nested package metadata: lib/core/' + file);
});

if (read('LICENSE').indexOf(licenceMarker) === -1) fail('root LICENSE is not the NuBloxSQL proprietary licence');

var releaseDocuments = [
  'README.md',
  'docs/README.md',
  'docs/RELEASE.md',
  'docs/SUPPORT.md',
  'docs/API.md',
  'docs/releases/1.1.0.md',
  'docs/releases/public-api-v1.json',
  'docs/releases/tier1-stable-evidence.json'
];

var userGuides = [
  'docs/guides/README.md',
  'docs/guides/01-getting-started.md',
  'docs/guides/02-connections-and-pooling.md',
  'docs/guides/03-sql-parameters-and-types.md',
  'docs/guides/04-prepared-and-results.md',
  'docs/guides/05-transactions.md',
  'docs/guides/06-streaming-and-operation-control.md',
  'docs/guides/07-metadata-and-introspection.md',
  'docs/guides/08-errors-retries-and-recovery.md',
  'docs/guides/09-observability-and-type-codecs.md',
  'docs/guides/10-dialects.md',
  'docs/guides/11-capabilities-and-portability.md',
  'docs/guides/12-typescript.md',
  'docs/guides/13-production-and-troubleshooting.md'
];

releaseDocuments.concat(userGuides).forEach(function (file) {
  if (!exists(file)) fail('missing authoritative release document/guide: ' + file);
});

function validateRelativeLinks(file) {
  if (!exists(file)) return;
  var text = read(file);
  var re = /\[[^\]]+\]\(([^)]+)\)/g;
  var match;
  while ((match = re.exec(text))) {
    var target = match[1].trim();
    if (!target || target[0] === '#' || /^(?:https?:|mailto:)/i.test(target)) continue;
    target = target.split('#')[0].split('?')[0];
    if (!target) continue;
    var resolved = path.normalize(path.join(path.dirname(file), target));
    if (!exists(resolved)) fail('broken documentation link in ' + file + ': ' + match[1]);
  }
}

releaseDocuments.filter(function (file) { return /\.md$/.test(file); }).concat(userGuides).forEach(validateRelativeLinks);

userGuides.forEach(function (file) {
  if (!exists(file)) return;
  var text = read(file);
  if (text.indexOf('docs/architecture/') !== -1 || text.indexOf('docs/v1/') !== -1) {
    fail('current user guide references archived documentation location: ' + file);
  }
});

[
  'docs/architecture',
  'docs/v1',
  'NUBLOX-SQL-ROADMAP.md',
  'lib/dialects/postgresql/docs'
].forEach(function (file) {
  if (exists(file)) fail('historical documentation must remain archived, not live: ' + file);
});

if (!exists('docs/archive/README.md')) fail('documentation archive must contain an archive status README');

['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml'].forEach(function (file) {
  if (exists(file)) fail('third-party dependency lockfile must not exist: ' + file);
});

var sqlCore = require(path.join(root, 'lib/core'));
if (sqlCore.CONTRACT_VERSION !== '1.0') fail('SQL Core CONTRACT_VERSION must be 1.0');

if (failures.length) {
  console.error('NuBloxSQL release architecture audit: FAILED');
  failures.forEach(function (failure) { console.error(' - ' + failure); });
  process.exitCode = 1;
} else {
  console.log('NuBloxSQL release architecture audit: PASS');
  console.log('One public package, validated current user guides, archived history, proprietary licence and zero third-party package dependencies are enforced.');
}
