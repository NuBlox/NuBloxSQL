import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateExtendedSoakEvidence,selectExtendedSoakReport}
  from './extended-soak-evidence.mjs';
import {BoundedMemoryTimeline} from './soak-observations.mjs';

const sha='a'.repeat(40),runId='12345';
function fixture(durationMs=1_800_000){
  const timeline=new BoundedMemoryTimeline();
  for(let t=0;t<=durationMs;t+=30000)
    timeline.record(t,{heapUsed:40_000_000,rss:90_000_000,
      external:3_000_000,arrayBuffers:2_000_000});
  return {
    schemaVersion:1,kind:'soak',status:'passed',
    environment:{revision:sha,ci:true,platform:'linux',arch:'x64',
      node:'v22.16.0',transport:'isolated-local',serverVersion:'8.4.13'},
    configuration:{mode:'soak',durationMs,iterations:100_000_000,concurrency:4},
    errors:{unexpected:0,expectedSqlErrors:100,codes:[]},
    workloads:{pool:{elapsedMs:durationMs+5,count:6000,completed:6000,
        workerCount:4,operationsPerSecond:30},reconnect:{count:6}},
    resources:{memoryTimeline:timeline.summary(),
      poolBeforeClose:{size:4,pending:0},
      poolAfterClose:{size:0,active:0,idle:0,connecting:0,pending:0,
        created:4,discarded:4},heapPeakBytes:30_000_000,
      rssPeakBytes:90_000_000,totalElapsedMs:durationMs+100}
  };
}
const base={revision:sha,runId,eventName:'schedule'};
function reject(mutate,opts=base){
  const duration=opts.eventName==='workflow_dispatch'
    ?Number(opts.hours)*3_600_000:1_800_000;
  const report=fixture(duration);
  mutate(report);
  assert.throws(()=>validateExtendedSoakEvidence(report,opts));
}
test('scheduled 30-minute evidence is same-revision, complete and redacted',()=>{
  const proof=validateExtendedSoakEvidence(fixture(),base);
  assert.equal(proof.requestedDurationMs,1_800_000);
  assert.equal(proof.completedOperations,6000);
  assert.equal(proof.poolSlotsAfterClose,0);
  assert.equal(proof.memorySamples,61);
  assert.equal(proof.heapUsedGrowthBytes,0);
  assert.equal(proof.rssGrowthBytes,0);
  assert.equal(proof.status,'passed');
  assert.ok(Object.isFrozen(proof));
  assert.equal(JSON.stringify(proof).includes('password'),false);
});
test('manually dispatched one- and two-hour runs must match their exact duration',()=>{
  for(const hours of ['1','2']){
    const opts={...base,eventName:'workflow_dispatch',hours};
    assert.equal(validateExtendedSoakEvidence(
      fixture(Number(hours)*3_600_000),opts).requestedDurationMs,
      Number(hours)*3_600_000);
    reject(r=>{r.configuration.durationMs-=1;},opts);
    reject(r=>{r.workloads.pool.elapsedMs=100;},opts);
  }
  for(const hours of ['0','3','1.0',undefined])
    assert.throws(()=>validateExtendedSoakEvidence(fixture(),{
      ...base,eventName:'workflow_dispatch',hours}));
  assert.throws(()=>validateExtendedSoakEvidence(fixture(),{
    ...base,eventName:'pull_request'}));
});
test('reject stale revision, forged identity and unsupported profiles',()=>{
  reject(r=>{r.environment.revision='b'.repeat(40);});
  reject(r=>{r.environment.serverVersion='8.4.11';});
  reject(r=>{r.environment.node='v24.0.0';});
  reject(r=>{r.environment.ci=false;});
  reject(r=>{r.environment.platform='darwin';});
  reject(r=>{r.environment.transport='verified-tls';});
  assert.throws(()=>validateExtendedSoakEvidence(fixture(),{...base,runId:'../12'}));
  assert.throws(()=>validateExtendedSoakEvidence(fixture(),{...base,revision:'x'.repeat(40)}));
});
test('reject early exit, incomplete work, error suppression and missing reconnect',()=>{
  reject(r=>{r.workloads.pool.elapsedMs=1000;});
  reject(r=>{r.configuration.iterations=5000;});
  reject(r=>{r.workloads.pool.completed=3;});
  reject(r=>{r.workloads.pool.count=10;});
  reject(r=>{r.workloads.pool.operationsPerSecond=0;});
  reject(r=>{r.errors.expectedSqlErrors=0;});
  reject(r=>{r.errors.unexpected=1;});
  reject(r=>{r.errors.codes.push('TIMEOUT');});
  reject(r=>{delete r.workloads.reconnect;});
  reject(r=>{r.status='failed';});
});
test('reject leaked pool sessions, waiters and absent process measurements',()=>{
  for(const key of ['size','active','idle','pending','connecting'])
    reject(r=>{r.resources.poolAfterClose[key]=1;});
  reject(r=>{r.resources.poolBeforeClose.size=5;});
  reject(r=>{r.resources.poolBeforeClose.pending=1;});
  reject(r=>{r.resources.poolAfterClose.discarded=1;});
  reject(r=>{r.resources.heapPeakBytes=0;});
  reject(r=>{r.resources.rssPeakBytes=Infinity;});
  reject(r=>{r.resources.totalElapsedMs=1;});
  reject(r=>{delete r.resources.poolAfterClose;});
  reject(r=>{delete r.resources.memoryTimeline;});
  reject(r=>{r.resources.memoryTimeline.samples[5].rssBytes=Infinity;});
  reject(r=>{r.resources.memoryTimeline.trend.heapUsedGrowthBytes=1000;});
  reject(r=>{r.resources.memoryTimeline.samples.length=1;});
});
test('reject duplicate, stale or missing persisted run artifacts',()=>{
  assert.equal(selectExtendedSoakReport(['soak-local-12345-1790000.json'],runId),
    'soak-local-12345-1790000.json');
  assert.throws(()=>selectExtendedSoakReport([],runId));
  assert.throws(()=>selectExtendedSoakReport(['soak-local-999-1790000.json'],runId));
  assert.throws(()=>selectExtendedSoakReport([
    'soak-local-12345-1790000.json','soak-local-12345-1800000.json'],runId));
  assert.throws(()=>selectExtendedSoakReport([
    'soak-local-12345-1790000.json','unreviewed.json'],runId));
});
