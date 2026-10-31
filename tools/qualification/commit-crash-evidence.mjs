/**
 * Pure acceptance contract for the destructive, ambiguous COMMIT crash case.
 * No DB access, Docker actions, SQL text, credentials or identifiers.
 */
import assert from 'node:assert/strict';

const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const natural=x=>Number.isSafeInteger(x)&&x>=0;
export function validateCommitCrashEvidence(report,{revision,runId,version='8.4.13'}={}){
  assert.match(revision??'',/^[0-9a-f]{40}$/);
  assert.match(runId??'',/^[0-9]+$/);
  assert.equal(version,'8.4.13','Only pinned fixture is approved');
  assert.ok(object(report)&&report.schemaVersion===1&&
    report.kind==='mysql-commit-crash-reconciliation'&&
    report.status==='passed'&&report.failureCode===null&&
    report.revision===revision&&report.runId===runId,
    'Wrong status or run identity');
  const e=report.environment;
  assert.ok(object(e)&&e.image==='mysql:'+version&&
    e.serverVersion===version&&e.ci===true&&
    e.platform==='linux'&&e.arch==='x64'&&/^v22\./.test(e.node??'')&&
    e.transport==='isolated-local','Wrong server/runtime fixture');
  const f=report.fault;
  assert.ok(object(f)&&f.commitWriteCount===1&&
    f.crashAfterCommitWrite===true&&f.serverKilled===true&&
    f.oldSessionRetired===true&&f.unknownOutcome===true&&
    f.transactionCallbacks===1&&f.insertExecutions===1,
    'Missing COMMIT crash and no-replay evidence');
  const rec=report.reconciliation;
  assert.ok(object(rec)&&rec.independentRead===true&&
    (rec.durableTokenCount===0||rec.durableTokenCount===1)&&
    rec.freshPoolQuery===true,
    'Reconciliation must be authoritative and bounded');
  const pool=report.pool;
  assert.ok(object(pool)&&natural(pool.created)&&pool.created>=2&&
    natural(pool.discarded)&&pool.discarded>=1&&
    pool.pendingAfterRecovery===0&&pool.sizeAfterClose===0&&
    pool.pendingAfterClose===0,'Native session or waiter leak');
  assert.ok(report.cleanup?.tableDropped===true&&
    report.cleanup?.mysqlRestored===true&&
    typeof report.elapsedMs==='number'&&
    Number.isFinite(report.elapsedMs)&&report.elapsedMs>0,
    'Incomplete disaster recovery and cleanup');
  return Object.freeze({
    schemaVersion:1,kind:'mysql-commit-crash-decision',status:'passed',
    revision,runId,version,serverCrashCount:1,commitWriteCount:1,
    transactionCallbacks:1,insertExecutions:1,
    durableTokenCount:rec.durableTokenCount,
    poolSlotsAfterClose:pool.sizeAfterClose,
    unknownOutcome:true,neverReplayed:true
  });
}
