import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessPartitionPromotion,validatePartitionEvidence}
  from './gtid-partition-evidence.mjs';

const revision='a'.repeat(40),runId='1234';
const context={revision,runId,version:'8.4.13'};
const fixture=()=>({
  schemaVersion:1,kind:'mysql-gtid-network-partition',status:'passed',
  failureCode:null,revision,runId,
  environment:{ci:true,node:'v22.23.4',platform:'linux',arch:'x64',
    sourceImage:'mysql:8.4.13',replicaImage:'mysql:8.4.13',
    sourceVersion:'8.4.13',replicaVersion:'8.4.13',
    distinctServerIds:true,transport:'isolated-local'},
  baseline:{gtidModeBoth:true,replicationAutoPosition:true,
    initialCatchupResult:0,initialTokenOnReplica:1,
    replicaSuperReadOnly:true},
  partition:{replicationNetworkDisconnected:true,
    sourceReachable:true,replicaReachable:true,
    sourceWritable:true,replicaSuperReadOnly:true,
    primaryWriteExecutions:1,standbyWriteExecutions:0,
    standbyClientWriteRejected:true,replicaMissingNewToken:true,
    gtidWaitTimedOut:1,sourceNotFenced:true,
    promotionAttempts:0,promotionDecision:'blocked',replayExecutions:0},
  healing:{replicationNetworkReconnected:true,receiverRunning:true,
    applierRunning:true,catchupResult:0,originalTokenCount:1,
    partitionTokenCount:1,replicaStillSuperReadOnly:true,
    sourceStillWritable:true},
  cleanup:{isolatedFixturesDisposed:true},elapsedMs:45000
});
const reject=change=>{
  const report=fixture();change(report);
  assert.throws(()=>validatePartitionEvidence(report,context));
};
test('partition safety refuses promotion when source lives or GTID lags',()=>{
  const missing=assessPartitionPromotion({
    primaryFenced:false,gtidApplied:false,
    operatorApproved:false,replicaReadOnly:true
  });
  assert.equal(missing.decision,'blocked');
  assert.deepEqual(missing.missing,[
    'source-not-fenced','source-gtid-not-applied','promotion-not-authorised'
  ]);
  assert.equal(missing.writesAllowed,false);
  assert.equal(missing.replayOriginalWrite,false);
  assert.ok(Object.isFrozen(missing));
  for(const key of ['primaryFenced','gtidApplied','operatorApproved',
    'replicaReadOnly']){
    const v={primaryFenced:true,gtidApplied:true,
      operatorApproved:true,replicaReadOnly:true};
    v[key]=false;
    assert.equal(assessPartitionPromotion(v).decision,'blocked');
  }
  assert.throws(()=>assessPartitionPromotion({
    primaryFenced:1,gtidApplied:false,
    operatorApproved:false,replicaReadOnly:true
  }));
  assert.equal(assessPartitionPromotion({
    primaryFenced:true,gtidApplied:true,operatorApproved:true,
    replicaReadOnly:true
  }).writesAllowed,false,'A policy check never performs promotion');
});
test('well-formed partition and healing report yields redacted decision',()=>{
  const result=validatePartitionEvidence(fixture(),context);
  assert.equal(result.unsafePromotionBlocked,true);
  assert.equal(result.gtidsCaughtUpAfterHealing,true);
  assert.equal(result.simultaneousWritableNodes,1);
  assert.equal(result.replayedWrites,0);
  assert.ok(Object.isFrozen(result));
  assert.equal(JSON.stringify(result).includes('password'),false);
});
test('reject stale or unpinned server and report identity',()=>{
  assert.throws(()=>validatePartitionEvidence(fixture(),
    {...context,revision:'b'.repeat(40)}));
  assert.throws(()=>validatePartitionEvidence(fixture(),
    {...context,runId:'999'}));
  reject(r=>{r.environment.replicaImage='mysql:latest';});
  reject(r=>{r.environment.distinctServerIds=false;});
  reject(r=>{r.environment.sourceVersion='8.4.11';});
  reject(r=>{r.environment.node='v24.0.0';});
  reject(r=>{r.environment.ci=false;});
  reject(r=>{r.status='failed';});
});
test('reject weak baseline and absent partition isolation',()=>{
  for(const key of ['gtidModeBoth','replicationAutoPosition',
    'replicaSuperReadOnly'])reject(r=>{r.baseline[key]=false;});
  reject(r=>{r.baseline.initialCatchupResult=1;});
  reject(r=>{r.baseline.initialTokenOnReplica=0;});
  for(const key of ['replicationNetworkDisconnected','sourceReachable',
    'replicaReachable','sourceWritable','replicaSuperReadOnly',
    'standbyClientWriteRejected','replicaMissingNewToken',
    'sourceNotFenced'])reject(r=>{r.partition[key]=false;});
  reject(r=>{r.partition.gtidWaitTimedOut=0;});
});
test('reject accidental two writers, replay, promotion and incomplete healing',()=>{
  reject(r=>{r.partition.primaryWriteExecutions=2;});
  reject(r=>{r.partition.standbyWriteExecutions=1;});
  reject(r=>{r.partition.replayExecutions=1;});
  reject(r=>{r.partition.promotionAttempts=1;});
  reject(r=>{r.partition.promotionDecision='promoted';});
  for(const key of ['replicationNetworkReconnected','receiverRunning',
    'applierRunning','replicaStillSuperReadOnly','sourceStillWritable'])
    reject(r=>{r.healing[key]=false;});
  reject(r=>{r.healing.catchupResult=1;});
  reject(r=>{r.healing.originalTokenCount=0;});
  reject(r=>{r.healing.partitionTokenCount=0;});
  reject(r=>{r.cleanup.isolatedFixturesDisposed=false;});
  reject(r=>{r.elapsedMs=Infinity;});
});
