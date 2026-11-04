import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BoundedMemoryTimeline,BoundedProgressTimeline,
  validateMemoryTimeline,validateProgressTimeline} from './soak-observations.mjs';
import {requestedWriteSoakDuration,selectWriteSoakReport,validateWriteSoakEvidence}
  from './write-soak-evidence.mjs';
const revision='a'.repeat(40),runId='12345';
function sample(event='push',hours='0'){
  const ms=requestedWriteSoakDuration(event,hours);
  const timer=new BoundedMemoryTimeline(),progress=new BoundedProgressTimeline();
  const snapshot={heapUsed:25000000,rss:95000000,external:1000000,arrayBuffers:100000};
  for(let stamp=0;stamp<=ms;stamp+=30000){
    timer.record(stamp,snapshot);
    progress.record(stamp,Math.floor(132*stamp/ms));
  }
  if(ms%30000!==0){
    timer.record(ms,snapshot);
    progress.record(ms,132);
  }
  const memoryTimeline=timer.summary();
  const memoryTrend=validateMemoryTimeline(memoryTimeline,{minDurationMs:ms});
  const progressTimeline=progress.summary();
  const progressEvidence=validateProgressTimeline(progressTimeline,{
    minDurationMs:ms,expectedCompleted:132,memoryTimeline
  });
  const workers=Array.from({length:4},(_,worker)=>({
    worker,committed:30,rolledBack:3,verified:33,finalCounter:30
  }));
  return {
    schemaVersion:1,kind:'mysql-write-soak',status:'passed',
    environment:{revision,runId,event,ci:true,node:'v22.16.0',
      platform:'linux',arch:'x64',transport:'isolated-local',serverVersion:'8.4.13'},
    options:{durationMs:ms,concurrency:4,maxTransactions:100000000},
    errors:{unexpected:0,codes:[]},
    workload:{serverVersion:'8.4.13',requestedDurationMs:ms,observedDurationMs:ms,
      attemptedTransactions:132,completedTransactions:132,
      committedTransactions:120,rolledBackTransactions:12,verifiedReads:132,
      finalCounterSum:120,workers,tableDropped:true,
      latency:{count:132,latencySamples:132,latencySampleCapacity:4096},
      resources:{poolBeforeClose:{size:4,pending:0,active:0},
        poolAfterClose:{size:0,idle:0,active:0,pending:0,connecting:0},
        memoryTimeline,memoryTrend,progressTimeline,progressEvidence}}
  };
}
const ctx={revision,runId,event:'push',hours:'0'};
test('same-run smoke and full-duration scheduled/manual evidence is independently valid',()=>{
  for(const [event,hours] of [['push','0'],['pull_request','0'],
    ['schedule','0'],['workflow_dispatch','1'],['workflow_dispatch','2']]){
    const verified=validateWriteSoakEvidence(sample(event,hours),{
      ...ctx,event,hours});
    assert.equal(verified.status,'passed');
    assert.equal(verified.tableDropped,true);
    assert.ok(verified.progressSamples>=2);
    assert.ok(verified.maxUnverifiedProgressMs<=90_000);
  }
  assert.equal(selectWriteSoakReport(['mysql-write-soak-12345.json'],runId),
    'mysql-write-soak-12345.json');
});
test('reject stale, shortened, duplicate, secret-bearing or forged release evidence',()=>{
  const mutations=[
    x=>{x.status='running';},
    x=>{x.environment.revision='b'.repeat(40);},
    x=>{x.environment.runId='54321';},
    x=>{x.environment.serverVersion='8.4.11';},
    x=>{x.environment.transport='verified-tls';},
    x=>{x.options.durationMs=1;},
    x=>{x.workload.observedDurationMs=9999;},
    x=>{x.workload.attemptedTransactions=200;},
    x=>{x.workload.committedTransactions=200;},
    x=>{x.workload.rolledBackTransactions=0;},
    x=>{x.workload.verifiedReads=0;},
    x=>{x.workload.workers[0].finalCounter=99;},
    x=>{x.workload.workers[3].verified=0;},
    x=>{x.workload.tableDropped=false;},
    x=>{x.workload.finalCounterSum=119;},
    x=>{x.workload.resources.poolAfterClose.size=1;},
    x=>{x.workload.resources.memoryTimeline.trend.heapUsedGrowthBytes=99999;},
    x=>{delete x.workload.resources.progressTimeline;},
    x=>{x.workload.resources.progressTimeline.progress.endCompleted=99;},
    x=>{x.workload.resources.progressTimeline.samples.at(-1).completed=131;},
    x=>{x.workload.resources.progressTimeline.samples[1].elapsedMs+=1000;},
    x=>{x.errors.unexpected=1;},
    x=>{x.workload.latency.count=1;}
  ];
  for(const change of mutations){
    const report=structuredClone(sample());change(report);
    assert.throws(()=>validateWriteSoakEvidence(report,ctx));
  }
  for(const files of [[],['other.json'],['mysql-write-soak-1.json'],
    ['mysql-write-soak-12345.json','other.json']])
    assert.throws(()=>selectWriteSoakReport(files,runId));
  for(const invalid of [['workflow_dispatch','0'],['unexpected','1']])
    assert.throws(()=>requestedWriteSoakDuration(...invalid));
});

test('verified TLS write evidence cannot be replaced by local or forged TLS checks',()=>{
  const checks={trustedIdentity:true,unrelatedCaRejected:true,
    wrongHostnameRejected:true,invalidPasswordRejected:true,
    serverRequiresTls:true,restrictedDdlRejected:true};
  const tlsSample=()=>{
    const report=structuredClone(sample());
    report.environment.transport='verified-tls';
    report.environment.clientPrincipal='nublox_write_test';
    report.environment.tlsChecks={...checks};
    return report;
  };
  assert.equal(validateWriteSoakEvidence(tlsSample(),
    {...ctx,transport:'verified-tls'}).transport,'verified-tls');
  assert.equal(selectWriteSoakReport(['mysql-write-soak-tls-12345.json'],runId,
    'verified-tls'),'mysql-write-soak-tls-12345.json');
  assert.throws(()=>validateWriteSoakEvidence(tlsSample(),ctx));
  assert.throws(()=>validateWriteSoakEvidence(sample(),
    {...ctx,transport:'verified-tls'}));
  for(const key of Object.keys(checks)){
    const modified=tlsSample();
    modified.environment.tlsChecks[key]=false;
    assert.throws(()=>validateWriteSoakEvidence(modified,
      {...ctx,transport:'verified-tls'}));
  }
  for(const field of ['clientPrincipal','tlsChecks']){
    const modified=tlsSample();
    delete modified.environment[field];
    assert.throws(()=>validateWriteSoakEvidence(modified,
      {...ctx,transport:'verified-tls'}));
  }
  assert.throws(()=>selectWriteSoakReport(['mysql-write-soak-12345.json'],
    runId,'verified-tls'));
});

test('write-soak evidence rejects long-duration SQL stagnation',()=>{
  const report=structuredClone(sample('schedule'));
  const timeline=new BoundedProgressTimeline();
  for(const observation of report.workload.resources.memoryTimeline.samples){
    const t=observation.elapsedMs;
    const completed=t<240_000?Math.floor(132*t/1_800_000):
      t<=390_000?17:Math.floor(132*t/1_800_000);
    timeline.record(t,completed);
  }
  report.workload.resources.progressTimeline=timeline.summary();
  const resources=report.workload.resources;
  // Recompute an honest derived summary before exercising the long-duration
  // stall check: never let a mismatched fixture summary mask the real error.
  resources.progressEvidence=validateProgressTimeline(resources.progressTimeline,{
    minDurationMs:0,expectedCompleted:132,memoryTimeline:resources.memoryTimeline
  });
  assert.throws(()=>validateWriteSoakEvidence(report,{
    ...ctx,event:'schedule'
  }),/gap without confirmed progress/);
});
