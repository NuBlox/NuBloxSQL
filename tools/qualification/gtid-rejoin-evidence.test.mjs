import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessFencedPromotion} from './gtid-promotion-evidence.mjs';
import {validateFormerPrimaryRejoinEvidence}
  from './gtid-rejoin-evidence.mjs';

const revision='a'.repeat(40),runId='1234';
const preconditions=()=>({
  primaryFenced:true,distinctServerIds:true,gtidAutoPosition:true,
  gtidApplied:true,replicaReadOnly:true,committedTokenPresent:true,
  operatorApproved:true,noDivergentWrites:true
});
const fixture=()=>({
  schemaVersion:1,kind:'mysql-gtid-former-primary-rejoin',
  status:'passed',failureCode:null,revision,runId,
  environment:{ci:true,node:'v22.22.0',platform:'linux',arch:'x64',
    primaryImage:'mysql:8.4.13',replicaImage:'mysql:8.4.13',
    primaryVersion:'8.4.13',replicaVersion:'8.4.13',
    distinctServerIds:true,transport:'isolated-local'},
  replication:{gtidModeOnBoth:true,autoPosition:true,
    replicaReadOnlyBefore:true,sourceCommitAcknowledged:true,
    appliedGtidWaitResult:0,originalTokenOnReplica:1,
    replicationReceiverRunning:true,replicationApplierRunning:true},
  promotion:{primaryKilled:true,primaryFencedAtPromotion:true,
    operatorApproved:true,replicationStopped:true,
    replicationConfigurationCleared:true,
    replicaWritableAfterPromotion:true,promotedWriteAcknowledged:true,
    promotedTokenCount:1,originalTokenCountAfterPromotion:1,
    oldPrimaryRemainedDown:true,noAutomaticReplay:true,
    originalWriteExecutions:1,promotedWriteExecutions:1,
    promotionDecision:'qualified-test-promotion'},
  rejoin:{persistedSuperReadOnlyBeforeCrash:true,
    restartHealthy:true,persistedSuperReadOnlyAfterRestart:true,
    rejectedOldPrimaryWrite:true,oldPrimaryWriteAttempts:1,
    noUnexpectedOldPrimaryWrites:true,reverseAutoPosition:true,
    receiverRunning:true,applierRunning:true,reverseGtidCatchupResult:0,
    originalTokenCount:1,promotedTokenCount:1,
    superReadOnlyAfterCatchup:true,oldPrimaryStillReadOnly:true,
    promotedPrimaryStillWritable:true},
  cleanup:{isolatedFixturesDisposed:true},elapsedMs:28000
});
test('test-only promotion requires every positive safety precondition',()=>{
  const good=assessFencedPromotion(preconditions());
  assert.equal(good.allowed,true);
  assert.equal(good.decision,'qualified-test-promotion');
  assert.ok(Object.isFrozen(good));
  for(const key of Object.keys(preconditions())){
    const options=preconditions();
    options[key]=false;
    const rejected=assessFencedPromotion(options);
    assert.equal(rejected.allowed,false,key);
    assert.deepEqual(rejected.missing,[key]);
    assert.equal(rejected.decision,'blocked');
  }
  const missing=preconditions();
  delete missing.operatorApproved;
  assert.throws(()=>assessFencedPromotion(missing));
});
const context={revision,runId,version:'8.4.13'};
const reject=mutate=>{
  const item=fixture();mutate(item);
  assert.throws(()=>validateFormerPrimaryRejoinEvidence(item,context));
};
test('accepts one fenced, GTID-caught-up, explicitly approved test promotion',()=>{
  const decision=validateFormerPrimaryRejoinEvidence(fixture(),context);
  assert.equal(decision.automaticReplays,0);
  assert.equal(decision.originalWrites,1);
  assert.equal(decision.promotedWrites,1);
  assert.equal(decision.primaryFenced,true);
  assert.equal(decision.writablePrimariesAfterRejoin,1);
  assert.equal(decision.reverseReplicationCaughtUp,true);
  assert.equal(decision.replicaCaughtUp,true);
  assert.ok(Object.isFrozen(decision));
  assert.equal(JSON.stringify(decision).includes('password'),false);
});
test('rejects wrong fixture/identity and invented execution history',()=>{
  assert.throws(()=>validateFormerPrimaryRejoinEvidence(fixture(),
    {...context,revision:'b'.repeat(40)}));
  assert.throws(()=>validateFormerPrimaryRejoinEvidence(fixture(),
    {...context,runId:'999'}));
  reject(r=>{r.environment.distinctServerIds=false;});
  reject(r=>{r.environment.primaryVersion='8.4.11';});
  reject(r=>{r.environment.replicaImage='mysql:latest';});
  reject(r=>{r.environment.node='v24.0.0';});
  reject(r=>{r.status='failed';});
});
test('rejects missing GTID replication, delayed application or writable standby',()=>{
  for(const field of ['gtidModeOnBoth','autoPosition','replicaReadOnlyBefore',
    'sourceCommitAcknowledged','originalTokenOnReplica',
    'replicationReceiverRunning','replicationApplierRunning']){
    reject(r=>{r.replication[field]=false;});
  }
  reject(r=>{r.replication.originalTokenOnReplica=0;});
  reject(r=>{r.replication.appliedGtidWaitResult=1;});
});
test('rejects unsafe promotion, double-write and non-disposed fixtures',()=>{
  for(const field of ['primaryKilled','primaryFencedAtPromotion',
    'operatorApproved','replicationStopped','replicationConfigurationCleared',
    'replicaWritableAfterPromotion','promotedWriteAcknowledged',
    'oldPrimaryRemainedDown','noAutomaticReplay']){
    reject(r=>{r.promotion[field]=false;});
  }
  reject(r=>{r.promotion.promotedTokenCount=0;});
  reject(r=>{r.promotion.originalTokenCountAfterPromotion=0;});
  reject(r=>{r.promotion.originalWriteExecutions=2;});
  reject(r=>{r.promotion.promotedWriteExecutions=2;});
  reject(r=>{r.promotion.promotionDecision='automatic';});
  reject(r=>{r.cleanup.isolatedFixturesDisposed=false;});
  reject(r=>{r.elapsedMs=Infinity;});
});

test('rejects unsafe rejoining: writable on restart, failed read-only writes, lag or role confusion',()=>{
  for(const key of [
    'persistedSuperReadOnlyBeforeCrash','restartHealthy',
    'persistedSuperReadOnlyAfterRestart','rejectedOldPrimaryWrite',
    'noUnexpectedOldPrimaryWrites','reverseAutoPosition',
    'receiverRunning','applierRunning','superReadOnlyAfterCatchup',
    'oldPrimaryStillReadOnly','promotedPrimaryStillWritable'
  ])reject(r=>{r.rejoin[key]=false;});
  reject(r=>{r.rejoin.oldPrimaryWriteAttempts=0;});
  reject(r=>{r.rejoin.oldPrimaryWriteAttempts=2;});
  reject(r=>{r.rejoin.reverseGtidCatchupResult=1;});
  reject(r=>{r.rejoin.reverseGtidCatchupResult=null;});
  reject(r=>{r.rejoin.originalTokenCount=0;});
  reject(r=>{r.rejoin.promotedTokenCount=0;});
});
