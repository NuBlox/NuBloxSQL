/** Same-run independent validation of disposable InnoDB write-endurance evidence. */
import assert from 'node:assert/strict';
import {validateMemoryTimeline,validateProgressTimeline} from './soak-observations.mjs';

const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const whole=x=>Number.isSafeInteger(x)&&x>=0;
export function requestedWriteSoakDuration(event,hours){
  if(event==='push'||event==='pull_request')return 10000;
  if(event==='schedule')return 1800000;
  if(event==='workflow_dispatch'&&(hours==='1'||hours==='2'))
    return Number(hours)*3600000;
  throw Error('Invalid endurance event or manual duration');
}
export function selectWriteSoakReport(files,runId,transport='isolated-local'){
  assert.ok(transport==='isolated-local'||transport==='verified-tls');
  assert.match(runId??'',/^\d{1,15}$/);
  assert.ok(Array.isArray(files));
  const matches=files.filter(x=>typeof x==='string'&&x.endsWith('.json'));
  const prefix=transport==='verified-tls'?'mysql-write-soak-tls-':'mysql-write-soak-';
  assert.deepEqual(matches,[prefix+runId+'.json'],
    'Exactly one same-run native report is required');
  return matches[0];
}
export function validateWriteSoakEvidence(report,{revision,runId,event,hours,transport='isolated-local'}){
  assert.ok(transport==='isolated-local'||transport==='verified-tls');
  assert.match(revision??'',/^[a-f0-9]{40}$/);
  assert.match(runId??'',/^\d{1,15}$/);
  const duration=requestedWriteSoakDuration(event,hours);
  assert.ok(object(report)&&report.schemaVersion===1&&
    report.kind==='mysql-write-soak'&&report.status==='passed');
  const env=report.environment;
  assert.ok(object(env)&&env.revision===revision&&env.runId===runId&&
    env.event===event&&env.ci===true&&env.platform==='linux'&&env.arch==='x64'&&
    /^v22\./.test(env.node??'')&&env.transport===transport&&
    /^8\.4\.13(?:[-+].*)?$/.test(env.serverVersion??''),
    'Pinned same-run version and runtime required');
  if(transport==='verified-tls'){
    assert.equal(env.clientPrincipal,'nublox_write_test',
      'Require restricted TLS write identity');
    assert.deepEqual(env.tlsChecks,{
      trustedIdentity:true,unrelatedCaRejected:true,
      wrongHostnameRejected:true,invalidPasswordRejected:true,
      serverRequiresTls:true,restrictedDdlRejected:true
    },'TLS identity, authentication and least-privilege checks required');
  }else{
    assert.ok(env.clientPrincipal===undefined||env.clientPrincipal===null);
    assert.ok(env.tlsChecks===undefined||env.tlsChecks===null);
  }
  assert.deepEqual(report.options,{durationMs:duration,concurrency:4,
    maxTransactions:100000000},'Write soak options differ from approved CI matrix');
  assert.deepEqual(report.errors,{unexpected:0,codes:[]});
  const w=report.workload;
  assert.ok(object(w)&&w.serverVersion===env.serverVersion&&w.tableDropped===true&&
    w.requestedDurationMs===duration&&
    typeof w.observedDurationMs==='number'&&w.observedDurationMs>=duration&&
    whole(w.attemptedTransactions)&&w.attemptedTransactions<100000000&&
    w.attemptedTransactions===w.completedTransactions&&
    whole(w.committedTransactions)&&w.committedTransactions>=4&&
    whole(w.rolledBackTransactions)&&w.rolledBackTransactions>=4&&
    w.committedTransactions+w.rolledBackTransactions===w.completedTransactions&&
    w.verifiedReads===w.completedTransactions&&
    w.finalCounterSum===w.committedTransactions,
    'Durable commit/rollback totals are incomplete or inconsistent');
  assert.ok(Array.isArray(w.workers)&&w.workers.length===4);
  let committed=0,rolledBack=0,verified=0;
  for(let i=0;i<4;i++){
    const row=w.workers[i];
    assert.ok(object(row)&&row.worker===i&&whole(row.committed)&&
      whole(row.rolledBack)&&whole(row.verified)&&
      row.verified===row.committed+row.rolledBack&&
      row.finalCounter===row.committed,'Per-worker durability mismatch');
    committed+=row.committed;rolledBack+=row.rolledBack;verified+=row.verified;
  }
  assert.equal(committed,w.committedTransactions);
  assert.equal(rolledBack,w.rolledBackTransactions);
  assert.equal(verified,w.verifiedReads);
  assert.ok(object(w.latency)&&w.latency.count===w.completedTransactions&&
    w.latency.latencySamples>0&&w.latency.latencySamples<=4096&&
    w.latency.latencySampleCapacity===4096,'Unbounded/missing latency evidence');
  const r=w.resources,before=r?.poolBeforeClose,after=r?.poolAfterClose;
  assert.ok(object(before)&&whole(before.size)&&before.size<=4&&
    before.pending===0&&before.active===0&&
    object(after)&&after.size===0&&after.idle===0&&after.active===0&&
    after.pending===0&&after.connecting===0,'Pooled native resources remain open');
  const memory=validateMemoryTimeline(r.memoryTimeline,{minDurationMs:duration});
  assert.deepEqual(r.memoryTrend,memory,'Inconsistent process memory growth summary');
  const progress=validateProgressTimeline(r.progressTimeline,{
    minDurationMs:duration,expectedCompleted:w.completedTransactions,
    memoryTimeline:r.memoryTimeline
  });
  assert.deepEqual(r.progressEvidence,progress,'Inconsistent SQL work progress summary');
  return Object.freeze({
    schemaVersion:1,kind:'mysql-write-soak-evidence',status:'passed',
    revision,runId,event,mysqlVersion:'8.4.13',transport,
    requestedDurationMs:duration,observedDurationMs:w.observedDurationMs,
    committedTransactions:committed,rolledBackTransactions:rolledBack,
    verifiedReads:verified,finalCounterSum:w.finalCounterSum,
    memorySamples:memory.samples,
    progressSamples:progress.samples,
    maxUnverifiedProgressMs:progress.maxUnverifiedProgressMs,
    poolSlotsAfterClose:0,tableDropped:true
  });
}
