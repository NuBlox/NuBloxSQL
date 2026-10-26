import {test} from 'node:test';
import assert from 'node:assert/strict';
import {profileInternalStages,profileOptions} from './internal-profile.mjs';
import {createInternalProfileStages} from './internal-stages.mjs';

test('native internals exercise bounded real framing, decoding and command scheduling',{timeout:10000},async()=>{
  const result=await profileInternalStages({
    stages:createInternalProfileStages(),
    options:{iterations:8,rounds:2,queueDepth:4}
  });
  assert.equal(result.kind,'mysql-native-internals-profile');
  assert.equal(result.trials.length,10);
  assert.equal(result.latencyUnit,'milliseconds per sample group (not per individual work unit)');
  for(const trial of result.trials){
    assert.equal(trial.count,8);
    assert.equal(trial.elapsedMs>0,true);
    assert.ok(trial.minMs>=0);
    assert.ok(trial.p99Ms>=trial.p50Ms);
    assert.equal(trial.workUnits,trial.count*trial.operationsPerSample);
    assert.ok(Number.isFinite(trial.workUnitsPerSecond));
    if(trial.stage==='binaryRowDecode')
      assert.equal(trial.workUnits,8*128);
    if(trial.stage==='contendedPing')
      assert.equal(trial.workUnits,8*4);
  }
  assert.deepEqual(result.trials.slice(0,5).map(t=>t.stage),[
    'asyncHarness','packetFraming','binaryRowDecode','serialPing','contendedPing'
  ]);
  assert.deepEqual(result.trials.slice(5).map(t=>t.stage),[
    'packetFraming','binaryRowDecode','serialPing','contendedPing','asyncHarness'
  ]);
  assert.ok(!JSON.stringify(result).includes('test-password'));
  assert.ok(!JSON.stringify(result).includes('SELECT'));
});

test('profiling options fail closed outside safety bounds',()=>{
  assert.deepEqual(profileOptions({iterations:8,rounds:2,queueDepth:2}),{
    iterations:8,rounds:2,queueDepth:2
  });
  for(const key of ['iterations','rounds','queueDepth']){
    for(const invalid of [-1,0,NaN,Infinity,0.5,'bad']){
      assert.throws(()=>profileOptions({[key]:invalid}),/Invalid .*internal profile/);
    }
  }
  assert.throws(()=>profileOptions({iterations:2001}));
  assert.throws(()=>profileOptions({rounds:9}));
  assert.throws(()=>profileOptions({queueDepth:17}));
  assert.throws(()=>profileOptions(null));
});

test('timed stage failure and stage cleanup both prevent a passed report',async()=>{
  const names=['asyncHarness','packetFraming','binaryRowDecode','serialPing','contendedPing'];
  let closed=0,called=0;
  const broken={};
  for(const name of names)broken[name]=async()=>({
    operationsPerSample:1,
    async sample(){
      called++;
      if(name==='packetFraming')throw Error('synthetic framing failure');
    },
    close(){closed++;}
  });
  await assert.rejects(profileInternalStages({
    options:{iterations:8,rounds:2,queueDepth:2},
    stages:broken
  }),/synthetic framing failure/);
  assert.equal(closed,2);
  assert.ok(called>=13,'first profile completed warmup and timed samples');
  const invalid={...broken,asyncHarness:async()=>({
    operationsPerSample:0,sample(){},close(){closed++;}
  })};
  await assert.rejects(profileInternalStages({
    options:{iterations:8,rounds:2,queueDepth:2},
    stages:invalid
  }),/Invalid internal benchmark stage/);
  assert.equal(closed,3);
});

test('profiling preserves work-unit throughput while sample count stays bounded',async()=>{
  const names=['asyncHarness','packetFraming','binaryRowDecode','serialPing','contendedPing'];
  const factories=Object.fromEntries(names.map(name=>[name,async()=>({
    operationsPerSample:name==='binaryRowDecode'?128:1,
    sample(){},
    close(){}
  })]));
  let clock=0;
  const report=await profileInternalStages({
    options:{iterations:8,rounds:2,queueDepth:2},
    stages:factories,
    now:()=>++clock
  });
  for(const trial of report.trials){
    assert.equal(trial.count,8);
    assert.equal(trial.workUnitsPerSecond,
      Math.round(trial.workUnits*1000/trial.elapsedMs*1000)/1000);
    if(trial.stage==='binaryRowDecode')assert.equal(trial.workUnits,1024);
  }
});
