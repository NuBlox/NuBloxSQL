import {validateMemoryTimeline} from './soak-observations.mjs';
import assert from 'node:assert/strict';

const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const whole=value=>Number.isSafeInteger(value)&&value>=0;
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;

/** Independently validate long-running MySQL read-soak evidence. No database
 * connections, secrets, user data, or production driver hooks are involved. */
export function validateExtendedSoakEvidence(report,{revision,runId,eventName,hours}={}){
  assert.match(revision??'',/^[a-f0-9]{40}$/,'Exact source revision required');
  assert.match(runId??'',/^\d+$/,'Numeric workflow run ID required');
  assert.ok(eventName==='schedule'||eventName==='workflow_dispatch',
    'Only scheduled and manually dispatched endurance evidence is accepted');
  const durationMs=eventName==='schedule'?1_800_000:
    hours==='1'?3_600_000:hours==='2'?7_200_000:null;
  assert.ok(durationMs!==null,'Manual duration must be one or two hours');
  assert.ok(record(report)&&report.schemaVersion===1&&report.kind==='soak'&&
    report.status==='passed','Passed v1 soak report required');
  const env=report.environment;
  assert.ok(record(env)&&env.revision===revision&&env.ci===true&&
    env.platform==='linux'&&env.arch==='x64'&&/^v22\./.test(env.node??'')&&
    env.transport==='isolated-local'&&
    /^8\.4\.13(?:[-+].*)?$/.test(env.serverVersion??''),
    'Pinned same-revision MySQL 8.4.13/Node 22 environment required');
  const config=report.configuration;
  assert.ok(record(config)&&config.mode==='soak'&&
    config.durationMs===durationMs&&config.iterations===100_000_000&&
    config.concurrency===4,'Unapproved duration, iteration cap or concurrency');
  const errors=report.errors;
  assert.ok(record(errors)&&errors.unexpected===0&&
    Array.isArray(errors.codes)&&errors.codes.length===0&&
    whole(errors.expectedSqlErrors)&&errors.expectedSqlErrors>=1,
    'Unexpected errors or missing intentional SQL error recovery');
  const pool=report.workloads?.pool;
  assert.ok(record(pool)&&positive(pool.elapsedMs)&&pool.elapsedMs>=durationMs&&
    whole(pool.count)&&whole(pool.completed)&&pool.count===pool.completed&&
    pool.completed>=config.concurrency&&pool.workerCount===config.concurrency&&
    positive(pool.operationsPerSecond),
    'Incomplete full-duration workload or invalid operation counts');
  const reconnect=report.workloads?.reconnect;
  assert.ok(record(reconnect)&&whole(reconnect.count)&&reconnect.count>=1,
    'Missing post-soak connection recovery');
  const resources=report.resources;
  const before=resources?.poolBeforeClose,after=resources?.poolAfterClose;
  assert.ok(record(before)&&whole(before.size)&&before.size>=1&&
    before.size<=config.concurrency&&before.pending===0&&
    record(after)&&after.size===0&&after.active===0&&after.idle===0&&
    after.pending===0&&after.connecting===0&&
    whole(after.created)&&after.created>=1&&
    whole(after.discarded)&&after.discarded>=after.created&&
    positive(resources.heapPeakBytes)&&positive(resources.rssPeakBytes)&&
    positive(resources.totalElapsedMs)&&resources.totalElapsedMs>=durationMs,
    'Pool cleanup or process resource evidence incomplete');
  const memoryTrend=validateMemoryTimeline(resources.memoryTimeline,
    {minDurationMs:durationMs});
  return Object.freeze({
    schemaVersion:1,kind:'mysql-extended-soak-evidence',status:'passed',
    revision,runId,eventName,mysqlVersion:'8.4.13',
    requestedDurationMs:durationMs,observedDurationMs:pool.elapsedMs,
    completedOperations:pool.completed,expectedSqlErrors:errors.expectedSqlErrors,
    poolSlotsAfterClose:after.size,
    memorySamples:memoryTrend.samples,
    heapUsedGrowthBytes:memoryTrend.heapUsedGrowthBytes,
    rssGrowthBytes:memoryTrend.rssGrowthBytes
  });
}
export function selectExtendedSoakReport(names,runId){
  assert.match(runId??'',/^\d+$/);
  assert.ok(Array.isArray(names)&&names.every(x=>typeof x==='string'));
  const json=names.filter(n=>n.endsWith('.json'));
  assert.equal(json.length,1,'Require exactly one original JSON report');
  assert.match(json[0],new RegExp('^soak-local-'+runId+'-[0-9]+\\.json$'),
    'Report filename must match this workflow run');
  return json[0];
}
