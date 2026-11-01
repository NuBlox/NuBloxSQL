import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessTwoNodeCutover,validateTwoNodeCutoverEvidence}
  from './two-node-cutover-evidence.mjs';

const revision='a'.repeat(40),runId='12345';
const context={revision,runId,version:'8.4.13'};
const fixture=()=>({
  schemaVersion:1,kind:'mysql-two-node-cutover',status:'passed',
  failureCode:null,revision,runId,
  environment:{ci:true,node:'v22.23.4',platform:'linux',arch:'x64',
    transport:'isolated-local',primaryImage:'mysql:8.4.13',
    standbyImage:'mysql:8.4.13',primaryVersion:'8.4.13',
    standbyVersion:'8.4.13',distinctServerIdentities:true},
  outcome:{primaryCommittedBeforeCrash:true,primaryKilled:true,
    inflightQueryInterrupted:true,oldPoolDiscarded:true,
    standbyReachableAfterCrash:true,standbyCommittedTokenCount:0,
    primaryCommittedTokenCountAfterRestart:1,primaryRestored:true,
    originalWriteExecutions:1,originalWriteReplays:0,
    standbyWriteExecutions:0,promotionAttempts:0,
    cutoverDecision:'blocked-unverified-replication',resumeWrites:false},
  resources:{primaryPoolCreated:1,primaryPoolDiscarded:1,
    primaryPoolAfterClose:0,pendingAfterClose:0},
  cleanup:{primaryTableDropped:true,standbyTableDropped:true,
    primaryServerHealthy:true},elapsedMs:35000
});
const reject=mutate=>{
  const report=fixture();mutate(report);
  assert.throws(()=>validateTwoNodeCutoverEvidence(report,context));
};

test('explicit endpoint switch never treats health or token equality as promotion authority',()=>{
  for(const committed of [true,false])for(const hasToken of [true,false]){
    const d=assessTwoNodeCutover({primaryCommitted:committed,
      standbyHasToken:hasToken});
    assert.equal(d.decision,'blocked-unverified-replication');
    assert.equal(d.resumeWrites,false);
    assert.equal(d.replayOriginalWrite,false);
    assert.ok(Object.isFrozen(d));
  }
  assert.equal(assessTwoNodeCutover({primaryCommitted:true,
    standbyHasToken:false}).reason,'committed-token-missing-on-standby');
  assert.throws(()=>assessTwoNodeCutover({primaryCommitted:1,standbyHasToken:false}));
});
test('same-run independent two-node crash decision preserves zero replay',()=>{
  const d=validateTwoNodeCutoverEvidence(fixture(),context);
  assert.equal(d.verifiedIndependentNodes,2);
  assert.equal(d.originalWriteReplays,0);
  assert.equal(d.standbyWrites,0);
  assert.equal(d.resumeWrites,false);
  assert.ok(Object.isFrozen(d));
  const text=JSON.stringify(d);
  assert.equal(text.includes('password'),false);
  assert.equal(text.includes('token'),false);
});
test('reject swapped, unpinned and aliased endpoint identities',()=>{
  assert.throws(()=>validateTwoNodeCutoverEvidence(fixture(),{
    ...context,revision:'b'.repeat(40)}));
  assert.throws(()=>validateTwoNodeCutoverEvidence(fixture(),{
    ...context,runId:'999'}));
  assert.throws(()=>validateTwoNodeCutoverEvidence(fixture(),{
    ...context,version:'8.4.11'}));
  reject(r=>{r.environment.distinctServerIdentities=false;});
  reject(r=>{r.environment.standbyVersion='8.4.11';});
  reject(r=>{r.environment.primaryImage='mysql:latest';});
  reject(r=>{r.environment.node='v24.0.0';});
  reject(r=>{r.environment.platform='darwin';});
  reject(r=>{r.environment.ci=false;});
});
test('reject missing server crash, fake replication, replay or silent promotion',()=>{
  reject(r=>{r.outcome.primaryCommittedBeforeCrash=false;});
  reject(r=>{r.outcome.primaryKilled=false;});
  reject(r=>{r.outcome.inflightQueryInterrupted=false;});
  reject(r=>{r.outcome.oldPoolDiscarded=false;});
  reject(r=>{r.outcome.standbyReachableAfterCrash=false;});
  reject(r=>{r.outcome.standbyCommittedTokenCount=1;});
  reject(r=>{r.outcome.primaryCommittedTokenCountAfterRestart=0;});
  reject(r=>{r.outcome.primaryRestored=false;});
  reject(r=>{r.outcome.originalWriteExecutions=2;});
  reject(r=>{r.outcome.originalWriteReplays=1;});
  reject(r=>{r.outcome.standbyWriteExecutions=1;});
  reject(r=>{r.outcome.promotionAttempts=1;});
  reject(r=>{r.outcome.cutoverDecision='promoted';});
  reject(r=>{r.outcome.resumeWrites=true;});
});
test('reject retained slots, incomplete restoration, missing cleanup and invalid observations',()=>{
  reject(r=>{r.resources.primaryPoolCreated=0;});
  reject(r=>{r.resources.primaryPoolDiscarded=0;});
  reject(r=>{r.resources.primaryPoolAfterClose=1;});
  reject(r=>{r.resources.pendingAfterClose=1;});
  reject(r=>{r.cleanup.primaryTableDropped=false;});
  reject(r=>{r.cleanup.standbyTableDropped=false;});
  reject(r=>{r.cleanup.primaryServerHealthy=false;});
  reject(r=>{r.status='failed';});
  reject(r=>{r.failureCode='CLEANUP_FAILED';});
  reject(r=>{r.elapsedMs=Infinity;});
});
