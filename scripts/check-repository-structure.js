'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');

var root=path.resolve(__dirname,'..');

function exists(relative){return fs.existsSync(path.join(root,relative));}

[
  'apps/shell',
  'docs/architecture',
  'docs/cookbook',
  'docs/guides',
  'docs/product',
  'docs/releases',
  'lib/capabilities',
  'lib/client',
  'lib/core',
  'lib/dialects',
  'lib/lifecycle',
  'lib/jobs',
  'scripts',
  'test',
  'types'
].forEach(function(relative){
  assert(exists(relative),'required repository path missing: '+relative);
});

[
  'packages',
  'shell',
  'tool',
  'docs/strategy',
  'docs/archive',
  'docs/releases/product-lifecycle-v1.json',
  '.eslintrc',
  '.eslintignore'
].forEach(function(relative){
  assert.strictEqual(exists(relative),false,'obsolete repository path must not exist: '+relative);
});

[
  'docs/product/BLUEPRINT.md',
  'docs/product/CAPABILITY-REGISTER.md',
  'docs/product/ROADMAP.md',
  'docs/architecture/DATABASE-LIFECYCLE.md',
  'docs/architecture/DATABASE-JOBS.md',
  'docs/architecture/REPOSITORY-STRUCTURE.md',
  'apps/shell/package.json',
  'scripts/suites/platform.json',
  'scripts/suites/release.json'
].forEach(function(relative){
  assert(exists(relative),'repository authority file missing: '+relative);
});

var pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
assert.strictEqual(pkg.scripts['test:platform'],'node scripts/run-suite.js scripts/suites/platform.json');
assert.strictEqual(pkg.scripts['release:qualify'],'node scripts/run-suite.js scripts/suites/release.json');

console.log('NuBloxSQL repository structure: PASS');
