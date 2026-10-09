'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var sql=require('..');

var root=path.resolve(__dirname,'..');
var lifecycle=JSON.parse(fs.readFileSync(path.join(root,'docs/releases/product-lifecycle-v2.json'),'utf8'));
var blueprint=fs.readFileSync(path.join(root,'docs/product/BLUEPRINT.md'),'utf8');
var detailed=fs.readFileSync(path.join(root,'docs/architecture/DATABASE-LIFECYCLE.md'),'utf8');

assert.strictEqual(lifecycle.schemaVersion,2);
assert.deepStrictEqual(lifecycle.supportedEngines,['postgresql','mysql','sqlite','sqlserver']);
assert.deepStrictEqual(
  lifecycle.phases.map(function(x){return x.id;}),
  ['select','install','initialize','discover','establish','build','use','understand','operate','change','retire']
);
assert.deepStrictEqual(
  lifecycle.domains.map(function(x){return x.id;}),
  ['engine-lifecycle','runtime','language','intelligence','engineering','administration','operations','portability-governance']
);
assert.ok(lifecycle.infrastructureBoundary.owns.includes('engine installation through explicit providers'));
assert.ok(lifecycle.infrastructureBoundary.owns.includes('engine/runtime decommission through explicit providers'));
assert.ok(lifecycle.infrastructureBoundary.doesNotOwn.includes('generic VM provisioning'));
assert.ok(lifecycle.infrastructureBoundary.doesNotOwn.includes('arbitrary operating-system management'));

['lifecycle.installation','lifecycle.initialization','lifecycle.engine-upgrade','lifecycle.retirement'].forEach(function(id){
  var area=sql.productCoverage.area(id);
  assert.ok(area,'missing lifecycle coverage area '+id);
  assert.strictEqual(area.pillar,'lifecycle');
  assert.ok(sql.productCoverage.gaps().some(function(x){return x.id===id;}),'expected lifecycle gap '+id);
});

assert.match(blueprint,/complete SQL database lifecycle/);
assert.match(detailed,/Installation provider model/);
assert.match(detailed,/PostgreSQL/);
assert.match(detailed,/MySQL/);
assert.match(detailed,/SQL Server/);
assert.match(detailed,/SQLite/);

console.log('NuBloxSQL end-to-end lifecycle v2 contract: PASS');
