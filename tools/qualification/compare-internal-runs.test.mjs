import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareProfiles} from './compare-internal-runs.mjs';

const STAGES=['asyncHarness','packetFraming','binaryRowDecode','serialPing','contendedPing'];
function profile(revision,scale=1){
  return {
    status:'passed',
    environment:{revision,node:'v22.0.0',platform:'linux',arch:'x64'},
    result:{
      kind:'mysql-native-internals-profile',
      configuration:{iterations:16,rounds:2,queueDepth:4},
      trials:[1,2].flatMap(round=>STAGES.map(stage=>({
        round,stage,count:16,p50Ms:0.02,
        workUnitsPerSecond:1000*scale
      })))
    }
  };
}

test('paired B-A-A-B comparison detects bounded throughput differences',()=>{
  const compare=compareProfiles([
    profile('baseline'),profile('candidate',1.5),
    profile('candidate',1.5),profile('baseline')
  ]);
  assert.equal(compare.stages.length,5);
  assert.equal(compare.baselineRevision,'baseline');
  assert.equal(compare.candidateRevision,'candidate');
  for(const stage of compare.stages){
    assert.equal(stage.candidateToBaselineThroughputRatio,1.5);
    assert.equal(stage.baselineRoundCount,4);
    assert.equal(stage.candidateRoundCount,4);
  }
  assert.ok(!JSON.stringify(compare).includes('SELECT'));
  assert.match(compare.caveat,/prevent definitive claims/);
});

test('profile comparator rejects missing, duplicated and non-finite trials',()=>{
  const valid=[
    profile('base'),profile('candidate'),
    profile('candidate'),profile('base')
  ];
  assert.throws(()=>compareProfiles(valid.slice(1)),/four B-A-A-B/);
  for(const issue of [
    p=>p.result.trials.pop(),
    p=>{p.result.trials[1]={...p.result.trials[0]};},
    p=>{p.result.trials[1].workUnitsPerSecond=Infinity;},
    p=>{p.result.trials[1].count=0;},
    p=>{p.status='failed';}
  ]){
    const reports=structuredClone(valid);
    issue(reports[1]);
    assert.throws(()=>compareProfiles(reports),/profiling report|Incomplete|Malformed/);
  }
});

test('mismatched commits, options and Node environments must not be compared',()=>{
  const original=[
    profile('base'),profile('candidate'),
    profile('candidate'),profile('base')
  ];
  for(const mutate of [
    values=>{values[3].environment.revision='different-base';},
    values=>{values[2].environment.revision='different-candidate';},
    values=>{values[1].environment.node='v24.0.0';},
    values=>{values[2].result.configuration.iterations=32;},
    values=>{values[1].environment.revision='base';}
  ]){
    const values=structuredClone(original);
    mutate(values);
    assert.throws(()=>compareProfiles(values),/mismatch|distinct|Malformed/);
  }
});
