'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');

var root=path.resolve(__dirname,'..');
var sql=require(root);

var blueprintPath=path.join(root,'docs/product/BLUEPRINT.md');
var lifecycleDocPath=path.join(root,'docs/architecture/DATABASE-LIFECYCLE.md');
var jobsDocPath=path.join(root,'docs/architecture/DATABASE-JOBS.md');
var lifecyclePath=path.join(root,'docs/releases/product-lifecycle-v2.json');

assert(fs.existsSync(blueprintPath),'canonical product blueprint is missing');
assert(fs.existsSync(lifecycleDocPath),'database lifecycle architecture is missing');
assert(fs.existsSync(jobsDocPath),'database job architecture is missing');
assert(fs.existsSync(lifecyclePath),'machine-readable product lifecycle is missing');

var blueprint=fs.readFileSync(blueprintPath,'utf8');
var lifecycleDoc=fs.readFileSync(lifecycleDocPath,'utf8');
var jobsDoc=fs.readFileSync(jobsDocPath,'utf8');
var lifecycle=JSON.parse(fs.readFileSync(lifecyclePath,'utf8'));

assert(blueprint.includes('one coherent JavaScript and TypeScript API for the complete SQL database lifecycle'),'canonical lifecycle promise missing');
assert(blueprint.includes('One developer API, honest dialect semantics.'),'governing design rule missing');
assert(blueprint.includes('## Infrastructure boundary'),'infrastructure boundary missing');
assert(blueprint.includes('## Product decision gate'),'product decision gate missing');
assert(blueprint.includes('## Fixed development sequence'),'fixed development sequence missing');
assert(blueprint.includes('## Source-of-truth hierarchy'),'source-of-truth hierarchy missing');
assert(blueprint.includes('Select. Install. Initialize. Discover. Establish. Build. Use. Understand. Operate. Change. Retire.'),'complete lifecycle promise missing');

assert(lifecycleDoc.includes('## Canonical lifecycle'),'detailed lifecycle model missing');
assert(jobsDoc.includes('## Core distinction'),'operation/job/workflow distinction missing');
assert(jobsDoc.includes('## Full lifecycle job map'),'full lifecycle job map missing');

assert.strictEqual(lifecycle.schemaVersion,2);
assert.deepStrictEqual(lifecycle.supportedEngines,['postgresql','mysql','sqlite','sqlserver']);
assert.strictEqual(lifecycle.phases.length,11);
assert.deepStrictEqual(
  lifecycle.phases.map(function(entry){return entry.id;}),
  ['select','install','initialize','discover','establish','build','use','understand','operate','change','retire']
);
assert.strictEqual(lifecycle.domains.length,8);
assert.deepStrictEqual(
  lifecycle.domains.map(function(entry){return entry.id;}),
  ['engine-lifecycle','runtime','language','intelligence','engineering','administration','operations','portability-governance']
);
assert.strictEqual(lifecycle.authoritativeDocument,'docs/product/BLUEPRINT.md');
assert.strictEqual(lifecycle.detailedLifecycleDocument,'docs/architecture/DATABASE-LIFECYCLE.md');

[
  'lifecycle.installation',
  'lifecycle.initialization',
  'lifecycle.engine-upgrade',
  'administration.bootstrap',
  'administration.configuration',
  'administration.security',
  'operations.health-sessions',
  'operations.maintenance',
  'operations.backup-recovery',
  'operations.replication-ha',
  'operations.capacity-storage',
  'operations.upgrade-readiness',
  'lifecycle.retirement',
  'automation.jobs'
].forEach(function(id){
  assert(sql.productCoverage.area(id),'complete-lifecycle coverage area missing: '+id);
});

console.log('NuBloxSQL product blueprint and lifecycle qualification: PASS');
