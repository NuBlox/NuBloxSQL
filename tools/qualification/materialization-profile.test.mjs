import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  materializationProfileOptions,profileMaterialization
} from './materialization-profile.mjs';

test('retained-result profiler requires bounded, numeric options',()=>{
  assert.deepEqual(materializationProfileOptions({rows:100,rounds:2,textBytes:64}),
    {rows:100,rounds:2,textBytes:64});
  for(const [key,values] of Object.entries({
    rows:[0,19,1001,0.5,'200',Infinity],
    rounds:[0,1,7,'2',-1,NaN],
    textBytes:[0,15,4097,0.1,'64',Infinity]
  })){
    for(const value of values)
      assert.throws(()=>materializationProfileOptions({[key]:value}),
        /Invalid materialization profile/);
  }
  assert.throws(()=>materializationProfileOptions(null));
  assert.throws(()=>materializationProfileOptions([]));
});

test('profile fails closed when GC or memory measurement is unavailable',()=>{
  assert.throws(()=>profileMaterialization({gc:null,
    options:{rows:20,rounds:2,textBytes:16}}),/expose-gc/);
  assert.throws(()=>profileMaterialization({gc:()=>{},memoryUsage:null,
    options:{rows:20,rounds:2,textBytes:16}}),/expose-gc/);
  assert.throws(()=>profileMaterialization({gc:()=>{},memoryUsage:()=>({}),
    options:{rows:20,rounds:2,textBytes:16}}),/Invalid process memory measurement/);
});

test('profile retains exact decoded results while reporting measured bytes and estimator',()=>{
  const result=profileMaterialization({
    options:{rows:20,rounds:2,textBytes:32},
    gc:global.gc??(()=>{}),
    memoryUsage:process.memoryUsage
  });
  assert.equal(result.kind,'mysql-materialized-memory-profile');
  assert.equal(result.units,'bytes');
  assert.equal(result.samples.length,6);
  assert.deepEqual(result.samples.map(sample=>sample.scenario),[
    'numeric8','nullable64','textBinary8',
    'nullable64','textBinary8','numeric8'
  ]);
  for(const sample of result.samples){
    assert.equal(sample.rows,20);
    assert.equal(sample.cells,20*sample.columns);
    assert.ok(sample.estimatedRetainedBytes>0);
    assert.ok(sample.logicalWireRowBytes>0);
    for(const name of ['heapUsed','rss','external','arrayBuffers']){
      assert.ok(Number.isSafeInteger(sample.before[name]));
      assert.ok(Number.isSafeInteger(sample.after[name]));
      assert.equal(sample.deltaBytes[name],
        sample.after[name]-sample.before[name]);
    }
  }
  assert.ok(result.samples.some(s=>s.columns===64));
  assert.ok(result.samples.some(s=>s.columns===8));
  assert.ok(result.limitations.some(s=>s.includes('not measured allocation')));
  const serialized=JSON.stringify(result);
  assert.ok(!serialized.includes('test-password'));
  assert.ok(!serialized.includes('SELECT'));
});
