/** Independent integrity gate for disposable TLS cache endurance artifacts.
 * Evidence is diagnostic, not external commercial release certification. */
import assert from 'node:assert/strict';
import {requestedCacheEnduranceDuration} from './cache-endurance.mjs';
import {validateMemoryTimeline,validateProgressTimeline}
  from './soak-observations.mjs';

const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const whole=x=>Number.isSafeInteger(x)&&x>=0;
const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const TLS_CHECKS=Object.freeze({
  verifiedTransport:true,nonemptyCipher:true,
  serverRequiresTls:true,unrelatedCaRejected:true
});
export function selectCacheEnduranceReport(names,runId){
  assert.match(runId??'',/^\d{1,15}$/);
  assert.ok(Array.isArray(names));
  const json=names.filter(x=>typeof x==='string'&&x.endsWith('.json'));
  assert.deepEqual(json,['mysql-cache-endurance-tls-'+runId+'.json'],
    'Exactly one same-run TLS cache endurance JSON required');
  return json[0];
}
function checkLatency(latency,count,capacity){
  assert.ok(object(latency)&&latency.count===count&&
    positive(latency.elapsedMs)&&
    positive(latency.operationsPerSecond)&&
    latency.latencySamples>0&&latency.latencySamples<=capacity&&
    latency.latencySampleCapacity===capacity&&
    latency.percentileMethod==='bounded-reservoir-nearest-rank'&&
    typeof latency.p50Ms==='number'&&
    typeof latency.p95Ms==='number'&&
    typeof latency.p99Ms==='number'&&
    latency.minMs>=0&&
    latency.minMs<=latency.p50Ms&&latency.p50Ms<=latency.p95Ms&&
    latency.p95Ms<=latency.p99Ms&&latency.p99Ms<=latency.maxMs,
    'Incomplete or inconsistent bounded latency evidence');
}
function checkMemorySample(snapshot){
  assert.ok(object(snapshot));
  for(const key of ['heapUsed','rss','external','arrayBuffers'])
    assert.ok(whole(snapshot[key]),'Invalid process memory metric');
}
export function validateCacheEnduranceEvidence(report,{
  revision,runId,event,minutes
}={}){
  assert.match(revision??'',/^[0-9a-f]{40}$/);
  assert.match(runId??'',/^\d{1,15}$/);
  const durationMs=requestedCacheEnduranceDuration(event,minutes);
  assert.ok(object(report)&&report.schemaVersion===1&&
    report.kind==='mysql-verified-tls-cache-endurance'&&
    report.status==='passed','Passed native TLS cache report required');
  const env=report.environment;
  assert.ok(object(env)&&env.revision===revision&&env.runId===runId&&
    env.event===event&&env.ci===true&&
    env.platform==='linux'&&env.arch==='x64'&&
    /^v22\./.test(env.node??'')&&
    /^8\.4\.13(?:[-+].*)?$/.test(env.mysqlVersion??'')&&
    env.transport==='verified-tls'&&env.maxPreparedStatements===8,
    'Unqualified TLS server or mismatched CI revision');
  assert.deepEqual(env.tlsChecks,TLS_CHECKS,'Required TLS security checks missing');
  assert.deepEqual(report.options,{
    durationMs,concurrency:8,maxOperations:100000000
  },'Unapproved full-duration cache endurance options');
  assert.deepEqual(report.errors,{codes:[]},'Unexpected cache endurance errors');
  assert.deepEqual(report.progress,{phase:'completed'},
    'Incomplete cache endurance phase');
  const w=report.workload;
  assert.ok(object(w)&&positive(w.elapsedMs)&&w.elapsedMs>=durationMs&&
    whole(w.completed)&&w.completed>=8&&w.completed<100000000&&
    whole(w.hot)&&w.hot>=8&&whole(w.churn)&&w.churn>=8&&
    w.hot+w.churn===w.completed&&
    w.preparedAfterWarmup===8&&w.preparedAfterWork===8&&
    w.preparedAfterClose===0&&w.samplingPeriodMs===30000&&
    w.windowLatencySampleCapacity===1024&&
    w.overallLatencySampleCapacity===4096,
    'Incomplete duration, query outcome or prepared handle release evidence');
  assert.ok(Array.isArray(w.workers)&&w.workers.length===8,
    'Eight independent connection workers must make progress');
  let totalHot=0,totalChurn=0;
  for(const worker of w.workers){
    assert.ok(object(worker)&&whole(worker.hot)&&worker.hot>0&&
      whole(worker.churn)&&worker.churn>0,
      'Per-connection hot and churn work required');
    totalHot+=worker.hot;totalChurn+=worker.churn;
  }
  assert.equal(totalHot,w.hot);
  assert.equal(totalChurn,w.churn);
  checkLatency(w.latency,w.completed,4096);
  checkLatency(w.hotLatency,w.hot,4096);
  checkLatency(w.churnLatency,w.churn,4096);
  assert.ok(Array.isArray(w.windows)&&w.windows.length>=1&&
    w.windows.length<=256&&
    Array.isArray(report.windows)&&
    report.windows.length===w.windows.length,
    'Missing bounded interval latency evidence');
  assert.deepEqual(report.windows,w.windows,
    'Persisted interval evidence differs from qualified work');
  let observed=0,previous=0;
  for(const item of w.windows){
    assert.ok(object(item)&&positive(item.elapsedMs)&&
      item.elapsedMs>=previous&&item.elapsedMs<=w.elapsedMs+1,
      'Nonmonotonic latency window timestamp');
    previous=item.elapsedMs;
    assert.ok(whole(item.latency?.count)&&item.latency.count>=1);
    checkLatency(item.latency,item.latency.count,1024);
    observed+=item.latency.count;
  }
  assert.equal(observed,w.completed,'Interval samples do not cover verified SQL work');
  if(durationMs>=1800000)
    assert.ok(w.windows.length>=Math.floor(durationMs/30000*0.75),
      'Sustained run missing interval latency windows');
  const memory=validateMemoryTimeline(w.memoryTimeline,{
    minDurationMs:durationMs
  });
  const progress=validateProgressTimeline(w.progressTimeline,{
    minDurationMs:durationMs,expectedCompleted:w.completed,
    memoryTimeline:w.memoryTimeline
  });
  assert.deepEqual(w.memoryEvidence,memory,
    'Process-memory trend not independently reproducible');
  assert.deepEqual(w.progressEvidence,progress,
    'SQL progress does not match memory timeline');
  checkMemorySample(w.postWarmupGc);
  checkMemorySample(w.afterCloseGc);
  return Object.freeze({
    schemaVersion:1,kind:'mysql-verified-tls-cache-endurance-evidence',
    status:'passed',revision,runId,event,
    requestedDurationMs:durationMs,observedDurationMs:w.elapsedMs,
    completed:w.completed,hot:w.hot,churn:w.churn,
    windows:w.windows.length,memorySamples:memory.samples,
    progressSamples:progress.samples,
    maxMemorySampleGapMs:memory.maxSampleGapMs,
    maxUnverifiedProgressMs:progress.maxUnverifiedProgressMs,
    heapUsedGrowthBytes:memory.heapUsedGrowthBytes,
    rssGrowthBytes:memory.rssGrowthBytes,
    preparedAfterClose:0
  });
}
