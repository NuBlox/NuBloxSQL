'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var root=path.resolve(__dirname,'..');
var sql=require(root);
var manifest=JSON.parse(fs.readFileSync(path.join(root,'docs/releases/product-coverage-v2.json'),'utf8'));

assert.strictEqual(sql.PRODUCT_COVERAGE_SCHEMA_VERSION,2);
assert.strictEqual(sql.productCoverage.SCHEMA_VERSION,2);
assert.strictEqual(sql.productCoverage.validate().valid,true);
assert.strictEqual(manifest.schemaVersion,2);

var report=sql.productCoverage.report();
var modelById=Object.create(null);
report.areas.forEach(function(area){modelById[area.id]=area;});

assert.strictEqual(manifest.areas.length,report.areas.length);
manifest.areas.forEach(function(entry){
  var area=modelById[entry.id];
  assert(area,'manifest area missing from model: '+entry.id);
  assert.strictEqual(area.pillar,entry.pillar,'pillar mismatch for '+entry.id);
  assert.strictEqual(area.status,entry.status,'status mismatch for '+entry.id);
});

report.areas.forEach(function(area){
  assert(area.evidence.length>0,'coverage area requires evidence: '+area.id);
  area.evidence.forEach(function(relative){
    assert(fs.existsSync(path.join(root,relative)),'coverage evidence missing for '+area.id+': '+relative);
  });
});

['platform.schema-diff','platform.migrations','dialect.sqlserver-parity'].forEach(function(id){
  assert(sql.productCoverage.gaps().some(function(area){return area.id===id;}),'expected strategic gap missing: '+id);
});

console.log('NuBloxSQL product coverage v2 release qualification: PASS');
