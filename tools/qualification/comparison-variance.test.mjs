import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyseComparison} from './comparison/analyse.mjs';
import {COMPARISON_WORKLOADS} from './comparison/core.mjs';

function evidence({rounds=6,iterations=12,nativeP50=2,peerP50=1}={}){
  const result=[];
  for(let round=1;round<=rounds;round++){
    for(const workload of COMPARISON_WORKLOADS){
      for(const [client,p50Ms] of [['nubloxsql',typeof nativeP50==='function'
        ?nativeP50(round):nativeP50],['mysql2',peerP50]]){
        result.push({
          client,workload,round,count:iterations,p50Ms,p95Ms:p50Ms*2,
          elapsedMs:10,operationsPerSecond:100
        });
      }
    }
  }
  return result;
}

test('paired ratio analysis is independent of row order and has deterministic intervals',()=>{
  const options={rounds:6,iterations:12};
  const input=evidence();
  const first=analyseComparison(input,options);
  const reversed=analyseComparison([...input].reverse(),options);
  assert.deepEqual(first,reversed);
  assert.equal(first.levelOfEvidence,'exploratory');
  assert.equal(first.workloads.length,3);
  for(const workload of first.workloads){
    assert.equal(workload.roundCount,6);
    assert.equal(workload.p50LatencyRatioNativeToMysql2.median,2);
    assert.equal(workload.p50LatencyRatioNativeToMysql2.geometricMean,2);
    assert.equal(workload.p50LatencyRatioNativeToMysql2.min,2);
    assert.equal(workload.p50LatencyRatioNativeToMysql2.max,2);
    assert.equal(workload.p50LatencyRatioNativeToMysql2.coefficientOfVariation,0);
    assert.equal(workload.p50LatencyRatioNativeToMysql2.roundsWithLowerNativeLatency,0);
    assert.equal(workload.p50LatencyRatioNativeToMysql2.roundsWithLowerPeerLatency,6);
    assert.deepEqual(
      [workload.p50LatencyRatioNativeToMysql2.exploratory95Interval.lower,
       workload.p50LatencyRatioNativeToMysql2.exploratory95Interval.upper],
      [2,2]
    );
    assert.deepEqual(workload.perRound.map(x=>x.firstClient),[
      'nubloxsql','mysql2','nubloxsql','mysql2','nubloxsql','mysql2'
    ]);
  }
  assert.ok(!JSON.stringify(first).includes('SELECT ?'));
});

test('mixed measured ratios preserve order sensitivity, variation and exact pairing',()=>{
  const result=analyseComparison(evidence({
    rounds:6,peerP50:2,nativeP50:n=>n
  }),{rounds:6,iterations:12});
  const stats=result.workloads[0].p50LatencyRatioNativeToMysql2;
  assert.equal(stats.median,1.75);
  assert.equal(stats.min,0.5);
  assert.equal(stats.max,3);
  assert.equal(stats.roundsWithLowerNativeLatency,1);
  assert.equal(stats.roundsWithLowerPeerLatency,4);
  assert.ok(stats.coefficientOfVariation>0);
  assert.ok(stats.orderStrata.nativeFirstGeometricMean<
    stats.orderStrata.mysql2FirstGeometricMean);
  assert.ok(stats.exploratory95Interval.lower<
    stats.exploratory95Interval.upper);
  assert.ok(stats.exploratory95Interval.lower<=stats.geometricMean);
  assert.ok(stats.exploratory95Interval.upper>=stats.geometricMean);
  assert.equal(stats.geometricMean,analyseComparison(evidence({
    rounds:6,peerP50:2,nativeP50:n=>n
  }),{rounds:6,iterations:12}).workloads[0]
    .p50LatencyRatioNativeToMysql2.geometricMean);
});

test('two-round CI smoke withholds statistical intervals and strong conclusions',()=>{
  const result=analyseComparison(evidence({rounds:2}),{
    rounds:2,iterations:12
  });
  assert.equal(result.levelOfEvidence,'insufficient-for-interval');
  assert.equal(result.workloads[0]
    .p50LatencyRatioNativeToMysql2.exploratory95Interval,null);
  assert.match(result.caveat,/prevent definitive performance claims/);
});

test('reject duplicate/missing pairs, inconsistent counts and invalid timings',()=>{
  const options={rounds:2,iterations:12};
  const data=evidence({rounds:2});
  assert.throws(()=>analyseComparison(data.slice(1),options),/Incomplete paired/);
  const duplicate=data.map(x=>({...x}));
  duplicate[1]={...duplicate[0]};
  assert.throws(()=>analyseComparison(duplicate,options),/Duplicate comparison/);
  const wrongCount=data.map(x=>({...x}));
  wrongCount[0].count=11;
  assert.throws(()=>analyseComparison(wrongCount,options),/Invalid or incomplete/);
  for(const bad of [0,-1,NaN,Infinity]){
    const malformed=data.map(x=>({...x}));
    malformed[0].p50Ms=bad;
    assert.throws(()=>analyseComparison(malformed,options),/Invalid or incomplete/);
  }
  const misplaced=data.map(x=>({...x}));
  misplaced[0].round=9;
  assert.throws(()=>analyseComparison(misplaced,options),/Invalid or incomplete/);
  assert.throws(()=>analyseComparison(data,{rounds:0,iterations:12}),/Incomplete/);
});
