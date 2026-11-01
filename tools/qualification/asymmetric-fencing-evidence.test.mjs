import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessAsymmetricPromotion,validateAsymmetricFencingEvidence}
  from './asymmetric-fencing-evidence.mjs';

const revision='a'.repeat(40),runId='123456';
const fixture=()=>({
  schemaVersion:1,kind:'mysql-asymmetric-fencing',status:'passed',
  failureCode:null,revision,runId,
  environment:{ci:true,node:'v22.22.0',platform:'linux',arch:'x64',
    transport:'isolated-local',sourceImage:'mysql:8.4.13',
    replicaImage:'mysql:8.4.13',sourceVersion:'8.4.13',
    replicaVersion:'8.4.13',distinctServerIds:true},
  baseline:{gtidModeBoth:true,replicationAutoPosition:true,
    initialCatchupResult:0,initialTokenOnReplica:1,replicaSuperReadOnly:true},
  observers:{independentObserverNetworks:true,
    sourceObserverCanReachSource:true,sourceObserverCannotReachReplica:true,
    replicaObserverCanReachReplica:true,replicaObserverCannotReachSource:true,
    reachabilityViewsConflict:true},
  partition:{replicationNetworkDisconnected:true,sourceReachable:true,
    replicaReachable:true,sourceWritable:true,replicaSuperReadOnly:true,
    primaryWriteExecutions:1,standbyWriteExecutions:0,
    standbyClientWriteRejected:true,replicaMissingNewToken:true,
    gtidWaitTimedOut:1,sourceNotFenced:true,promotionAttempts:0,
    promotionDecision:'blocked',replayExecutions:0},
  fencing:{adminWriteFencePersisted:true,sourceClientWriteRejected:true,
    writeFenceVerified:true,hardKillVerified:true,
    replicaStillLaggingAfterKill:true,promotionBlockedEvenWhenSourceDead:true,
    sourceRestartedHealthy:true,persistedFenceAfterRestart:true,
    sourceRestartWriteRejected:true,noOriginalWriteReplay:true},
  healing:{replicationNetworkReconnected:true,receiverRunning:true,
    applierRunning:true,catchupResult:0,originalTokenCount:1,
    partitionTokenCount:1,replicaStillSuperReadOnly:true,
    sourceStillSuperReadOnly:true,simultaneouslyWritableSources:0},
  cleanup:{isolatedFixturesDisposed:true,observerNetworksDisposed:true},
  elapsedMs:48000
});
const opts={revision,runId,version:'8.4.13'};
const reject=edit=>{
  const r=fixture();edit(r);
  assert.throws(()=>validateAsymmetricFencingEvidence(r,opts));
};
test('reachability never grants write authority even if fencing and GTIDs pass',()=>{
  const yes={sourceHardFenced:true,gtidCaughtUp:true,
    observerViewsAgree:true,operatorApproved:true,replicaReadOnly:true};
  assert.equal(assessAsymmetricPromotion(yes).canPromote,false);
  for(const key of Object.keys(yes)){
    const state={...yes,[key]:false};
    const d=assessAsymmetricPromotion(state);
    assert.equal(d.decision,'blocked');
    assert.equal(d.canReplay,false);
    assert.ok(d.blocking.length>0,key);
    assert.ok(Object.isFrozen(d.blocking));
  }
  assert.throws(()=>assessAsymmetricPromotion({...yes,gtidCaughtUp:1}));
});
test('accept independent observer views, hard kill, persisted fence and healed GTIDs',()=>{
  const decision=validateAsymmetricFencingEvidence(fixture(),opts);
  assert.equal(decision.hardKillObserved,true);
  assert.equal(decision.stalePromotionDenied,true);
  assert.equal(decision.bothNodesReadOnlyAfterRecovery,true);
  assert.equal(decision.automaticReplays,0);
  assert.ok(Object.isFrozen(decision));
  assert.ok(!JSON.stringify(decision).includes('password'));
});
test('reject stale, wrong version, wrong role and forged report',()=>{
  assert.throws(()=>validateAsymmetricFencingEvidence(fixture(),
    {...opts,runId:'42'}));
  assert.throws(()=>validateAsymmetricFencingEvidence(fixture(),
    {...opts,revision:'f'.repeat(40)}));
  reject(r=>{r.environment.node='v24.0.0';});
  reject(r=>{r.environment.sourceImage='mysql:latest';});
  reject(r=>{r.environment.distinctServerIds=false;});
  reject(r=>{r.status='failed';});
});
test('reject false independent vantage or missing actual partition and lag',()=>{
  for(const key of Object.keys(fixture().observers))
    reject(r=>{r.observers[key]=false;});
  for(const key of ['gtidModeBoth','replicationAutoPosition','replicaSuperReadOnly'])
    reject(r=>{r.baseline[key]=false;});
  reject(r=>{r.baseline.initialCatchupResult=1;});
  reject(r=>{r.baseline.initialTokenOnReplica=0;});
  for(const key of ['replicationNetworkDisconnected','sourceReachable',
    'replicaReachable','sourceWritable','replicaSuperReadOnly',
    'standbyClientWriteRejected','replicaMissingNewToken','sourceNotFenced'])
    reject(r=>{r.partition[key]=false;});
  reject(r=>{r.partition.gtidWaitTimedOut=0;});
  reject(r=>{r.partition.standbyWriteExecutions=1;});
  reject(r=>{r.partition.promotionAttempts=1;});
  reject(r=>{r.partition.replayExecutions=1;});
});
test('reject weak external fence, writable source restart and incomplete healing',()=>{
  for(const key of Object.keys(fixture().fencing))
    reject(r=>{r.fencing[key]=false;});
  for(const key of ['replicationNetworkReconnected','receiverRunning',
    'applierRunning','replicaStillSuperReadOnly','sourceStillSuperReadOnly'])
    reject(r=>{r.healing[key]=false;});
  reject(r=>{r.healing.catchupResult=1;});
  reject(r=>{r.healing.originalTokenCount=0;});
  reject(r=>{r.healing.partitionTokenCount=0;});
  reject(r=>{r.healing.simultaneouslyWritableSources=1;});
  reject(r=>{r.cleanup.isolatedFixturesDisposed=false;});
  reject(r=>{r.cleanup.observerNetworksDisposed=false;});
});
