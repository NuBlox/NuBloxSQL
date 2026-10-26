import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyzeReports} from './comparison/cross-run.mjs';

const workloads=['connectionOnly','preparedSequential','preparedConcurrent'];
function report(index,ratio=0.8,{rounds=2,version='8.4.11',revision='test-revision'}={}){
  const trials=[];
  for(let round=1;round<=rounds;round++)
    for(const workload of workloads)
      for(const client of ['nubloxsql','mysql2']){
        const p50Ms=client==='nubloxsql'?ratio:1;
        trials.push({
          round,workload,client,count:8,
          p50Ms,p95Ms:p50Ms*2,operationsPerSecond:100,elapsedMs:80
        });
      }
  return {
    schemaVersion:1,kind:'mysql-concurrent-prepared-comparison',
    status:'passed',
    environment:{
      timestamp:new Date(Date.UTC(2026,9,26,0,index)).toISOString(),
      revision,node:'v22.14.0',platform:'linux',arch:'x64',
      cpuCount:4,serverVersion:version,transport:'isolated-local',
      peerVersion:'3.24.6'
    },
    configuration:{
      iterations:8,concurrency:2,rounds,
      preparedWarmupPerSession:8,ordering:'alternating by round',
      workloads
    },trials,errors:{codes:[]}
  };
}

test('two matched runs show relative latency and variation without claiming a winner',()=>{
  const evidence=analyzeReports([report(1,0.7),report(2,0.6)]);
  assert.equal(evidence.repeatedRuns,2);
  for(const metric of evidence.workloads){
    assert.equal(metric.evidence,'inconclusive');
    assert.equal(metric.nativeLowerLatencyRuns,2);
    assert.equal(metric.mysql2LowerLatencyRuns,0);
    assert.equal(metric.signTestTwoSidedP,0.5);
    assert.equal(metric.nativeToMysql2P50RatioAcrossRuns.median,0.65);
    assert.ok(metric.nativeToMysql2P50RatioAcrossRuns.coefficientOfVariationPct>0);
  }
  assert.ok(!JSON.stringify(evidence).includes('SELECT ?'));
});

test('six separate reports with consistent direction give exact p=0.03125',()=>{
  const nativeLower=analyzeReports(Array.from({length:6},(_,i)=>report(i,0.8)));
  assert.equal(nativeLower.workloads[0].signTestTwoSidedP,0.03125);
  assert.equal(nativeLower.workloads[0].evidence,'consistent-direction-in-this-environment');
  assert.equal(nativeLower.workloads[0].nativeLowerLatencyRuns,6);
  const peerLower=analyzeReports(Array.from({length:6},(_,i)=>report(i,1.25)));
  assert.equal(peerLower.workloads[0].mysql2LowerLatencyRuns,6);
  assert.equal(peerLower.workloads[0].evidence,'consistent-direction-in-this-environment');
});

test('mixed directions or ties are inconclusive even after eight reports',()=>{
  const mixed=analyzeReports(Array.from({length:8},(_,i)=>report(i,i%2?0.9:1.1)));
  assert.equal(mixed.workloads[0].signTestTwoSidedP,1);
  assert.equal(mixed.workloads[0].evidence,'inconclusive');
  const tied=analyzeReports(Array.from({length:8},(_,i)=>report(i,1)));
  assert.equal(tied.workloads[0].signTestTwoSidedP,null);
  assert.equal(tied.workloads[0].tiedRuns,8);
  assert.equal(tied.workloads[0].evidence,'inconclusive');
});

test('cross-run analysis refuses mismatched environments, revisions, duplicate runs and corrupt client trials',()=>{
  const baseline=report(1);
  const wrong=[
    {...report(2),status:'failed'},
    report(1),
    report(2,0.8,{version:'9.0.0'}),
    report(2,0.8,{revision:'different'}),
    {...report(2),configuration:{...report(2).configuration,concurrency:3}},
    {...report(2),trials:report(2).trials.slice(1)},
    {...report(2),environment:{...report(2).environment,transport:'verified-tls'}},
    {...report(2),trials:report(2).trials.map((x,i)=>i===0?{...x,count:7}:x)},
    {...report(2),trials:report(2).trials.map((x,i)=>i===0?{...x,p50Ms:0}:x)}
  ];
  for(const other of wrong)
    assert.throws(()=>analyzeReports([baseline,other]),/Invalid or incomparable/);
  assert.throws(()=>analyzeReports([baseline]),/Invalid or incomparable/);
  assert.throws(()=>analyzeReports([null,report(2)]),/Invalid or incomparable/);
});
