import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  materializationProfileOptions,profileMaterialization,summarizeMaterializationSamples
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
  assert.equal(result.calibrationSummary.length,3);
  assert.deepEqual(result.calibrationSummary.map(s=>s.scenario),
    ['numeric8','nullable64','textBinary8']);
  for(const calibration of result.calibrationSummary){
    assert.equal(calibration.rounds,2);
    assert.equal(calibration.rows,20);
    assert.ok(calibration.estimatedRetainedBytes>0);
    assert.ok(Number.isFinite(calibration.medianHeapToEstimateRatio));
    for(const metric of ['heapUsed','rss','external','arrayBuffers']){
      const {minDeltaBytes,medianDeltaBytes,maxDeltaBytes}=
        calibration.measuredDeltaBytes[metric];
      assert.ok(minDeltaBytes<=medianDeltaBytes);
      assert.ok(medianDeltaBytes<=maxDeltaBytes);
    }
  }
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

test('calibration summary uses medians and preserves independent memory metrics',()=>{
  const scenarios=['numeric8','nullable64','textBinary8'];
  const samples=[];
  for(const round of [1,2,3]){
    for(const scenario of scenarios){
      const baseline=scenario==='numeric8'?100:
        scenario==='nullable64'?200:300;
      samples.push({
        scenario,round,rows:20,columns:8,estimatedRetainedBytes:400,
        deltaBytes:{
          heapUsed:baseline+round*10,
          rss:-round*100,
          external:round*5,
          arrayBuffers:round*2
        }
      });
    }
  }
  const summary=summarizeMaterializationSamples(samples);
  assert.equal(summary.length,3);
  assert.deepEqual(summary[0].measuredDeltaBytes.heapUsed,
    {minDeltaBytes:110,medianDeltaBytes:120,maxDeltaBytes:130});
  assert.deepEqual(summary[1].measuredDeltaBytes.rss,
    {minDeltaBytes:-300,medianDeltaBytes:-200,maxDeltaBytes:-100});
  assert.equal(summary[0].medianHeapToEstimateRatio,0.3);
  assert.equal(summary[2].measuredDeltaBytes.external.medianDeltaBytes,10);
});

test('calibration rejects missing, duplicate and incomparable observations',()=>{
  const delta={heapUsed:1,rss:-2,external:3,arrayBuffers:4};
  const base=['numeric8','nullable64','textBinary8']
    .flatMap(scenario=>[1,2].map(round=>({
      scenario,round,rows:20,columns:8,estimatedRetainedBytes:100,
      deltaBytes:{...delta}
    })));
  assert.equal(summarizeMaterializationSamples(base).length,3);
  assert.throws(()=>summarizeMaterializationSamples([]),/Missing/);
  assert.throws(()=>summarizeMaterializationSamples(base.slice(1)),/Incomplete/);
  assert.throws(()=>summarizeMaterializationSamples([
    {...base[0],round:1},...base.slice(1)]),/Duplicate|Incomplete/);
  assert.throws(()=>summarizeMaterializationSamples([
    {...base[0],estimatedRetainedBytes:101},...base.slice(1)]),/Incomparable/);
  assert.throws(()=>summarizeMaterializationSamples([
    {...base[0],deltaBytes:{...delta,heapUsed:NaN}},...base.slice(1)]),
    /Invalid materialization profile memory delta/);
});
