import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateCommitCrashEvidence} from './commit-crash-evidence.mjs';

const revision='a'.repeat(40),runId='12345',version='8.4.13';
const opts={revision,runId,version};
function fixture(){
  return {
    schemaVersion:1,kind:'mysql-commit-crash-reconciliation',
    status:'passed',failureCode:null,revision,runId,
    environment:{ci:true,node:'v22.22.0',platform:'linux',arch:'x64',
      image:'mysql:8.4.13',serverVersion:'8.4.13',transport:'isolated-local'},
    fault:{commitWriteCount:1,crashAfterCommitWrite:true,serverKilled:true,
      oldSessionRetired:true,unknownOutcome:true,
      transactionCallbacks:1,insertExecutions:1},
    reconciliation:{independentRead:true,durableTokenCount:0,freshPoolQuery:true},
    pool:{created:2,discarded:1,pendingAfterRecovery:0,
      sizeAfterClose:0,pendingAfterClose:0},
    cleanup:{tableDropped:true,mysqlRestored:true},
    elapsedMs:55000
  };
}
function reject(mutate){
  const report=fixture();
  mutate(report);
  assert.throws(()=>validateCommitCrashEvidence(report,opts));
}
test('both genuine crash outcomes are valid, independent and redacted',()=>{
  for(const count of [0,1]){
    const report=fixture();
    report.reconciliation.durableTokenCount=count;
    const decision=validateCommitCrashEvidence(report,opts);
    assert.equal(decision.durableTokenCount,count);
    assert.equal(decision.unknownOutcome,true);
    assert.equal(decision.neverReplayed,true);
    assert.equal(decision.poolSlotsAfterClose,0);
    assert.equal(decision.serverCrashCount,1);
    assert.ok(Object.isFrozen(decision));
    assert.equal(JSON.stringify(decision).includes('token'),false);
  }
});
test('reject invalid revision, wrong run and unreviewed server profile',()=>{
  assert.throws(()=>validateCommitCrashEvidence(fixture(),{...opts,revision:'X'.repeat(40)}));
  assert.throws(()=>validateCommitCrashEvidence(fixture(),{...opts,runId:'777'}));
  assert.throws(()=>validateCommitCrashEvidence(fixture(),{...opts,version:'8.4.14'}));
  reject(r=>{r.environment.node='v24.0.0';});
  reject(r=>{r.environment.ci=false;});
  reject(r=>{r.environment.serverVersion='8.4.11';});
  reject(r=>{r.environment.image='mysql:latest';});
  reject(r=>{r.environment.transport='verified-tls';});
  reject(r=>{r.environment.platform='darwin';});
});
test('refuse simulated or early crash, repeated COMMIT, callback and write replay',()=>{
  reject(r=>{r.fault.serverKilled=false;});
  reject(r=>{r.fault.crashAfterCommitWrite=false;});
  reject(r=>{r.fault.commitWriteCount=0;});
  reject(r=>{r.fault.commitWriteCount=2;});
  reject(r=>{r.fault.oldSessionRetired=false;});
  reject(r=>{r.fault.unknownOutcome=false;});
  reject(r=>{r.fault.transactionCallbacks=2;});
  reject(r=>{r.fault.insertExecutions=2;});
  reject(r=>{r.status='failed';});
});
test('reject unverified durability, sessions retained and incomplete cleanup',()=>{
  reject(r=>{r.reconciliation.durableTokenCount=2;});
  reject(r=>{r.reconciliation.durableTokenCount=null;});
  reject(r=>{r.reconciliation.independentRead=false;});
  reject(r=>{r.reconciliation.freshPoolQuery=false;});
  reject(r=>{r.pool.created=1;});
  reject(r=>{r.pool.discarded=0;});
  reject(r=>{r.pool.sizeAfterClose=1;});
  reject(r=>{r.pool.pendingAfterClose=1;});
  reject(r=>{r.pool.pendingAfterRecovery=1;});
  reject(r=>{r.cleanup.tableDropped=false;});
  reject(r=>{r.cleanup.mysqlRestored=false;});
  reject(r=>{r.elapsedMs=0;});
  reject(r=>{r.elapsedMs=Infinity;});
  reject(r=>{r.failureCode='CLEANUP_FAILED';});
});
