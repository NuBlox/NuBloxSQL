import assert from 'node:assert/strict';

/** An unfenced source or an un-applied GTID set blocks promotion,
 * regardless of replica health. Not a topology-election implementation. */
export function assessPartitionPromotion({
  primaryFenced,gtidApplied,operatorApproved,replicaReadOnly
}){
  for(const value of [primaryFenced,gtidApplied,operatorApproved,replicaReadOnly])
    assert.equal(typeof value,'boolean','Missing explicit partition safety evidence');
  const unmet=[];
  if(!primaryFenced)unmet.push('source-not-fenced');
  if(!gtidApplied)unmet.push('source-gtid-not-applied');
  if(!operatorApproved)unmet.push('promotion-not-authorised');
  if(!replicaReadOnly)unmet.push('replica-not-read-only');
  return Object.freeze({
    decision:unmet.length===0?'eligible-for-separate-authorised-evaluation':'blocked',
    writesAllowed:false,
    replayOriginalWrite:false,
    missing:Object.freeze(unmet)
  });
}

export function validatePartitionEvidence(report,{revision,runId,version='8.4.13'}={}){
  assert.match(revision??'',/^[0-9a-f]{40}$/);
  assert.match(runId??'',/^[0-9]+$/);
  assert.equal(version,'8.4.13','Unapproved MySQL version');
  assert.ok(report&&typeof report==='object'&&report.schemaVersion===1&&
    report.kind==='mysql-gtid-network-partition'&&
    report.status==='passed'&&report.failureCode===null&&
    report.revision===revision&&report.runId===runId,'Invalid report identity');
  const e=report.environment;
  assert.ok(e&&e.ci===true&&/^v22\./.test(e.node??'')&&
    e.platform==='linux'&&e.arch==='x64'&&
    e.sourceImage==='mysql:8.4.13'&&e.replicaImage==='mysql:8.4.13'&&
    e.sourceVersion===version&&e.replicaVersion===version&&
    e.distinctServerIds===true&&e.transport==='isolated-local',
    'Invalid replica or runtime identity');
  const baseline=report.baseline;
  assert.ok(baseline&&baseline.gtidModeBoth===true&&
    baseline.replicationAutoPosition===true&&
    baseline.initialCatchupResult===0&&baseline.initialTokenOnReplica===1&&
    baseline.replicaSuperReadOnly===true,
    'GTID replication was not verified before partition');
  const p=report.partition;
  assert.ok(p&&p.replicationNetworkDisconnected===true&&
    p.sourceReachable===true&&p.replicaReachable===true&&
    p.sourceWritable===true&&p.replicaSuperReadOnly===true&&
    p.primaryWriteExecutions===1&&p.standbyWriteExecutions===0&&
    p.standbyClientWriteRejected===true&&
    p.replicaMissingNewToken===true&&p.gtidWaitTimedOut===1&&
    p.sourceNotFenced===true&&p.promotionAttempts===0&&
    p.promotionDecision==='blocked'&&p.replayExecutions===0,
    'Partition did not prevent stale replica promotion or writes');
  const h=report.healing;
  assert.ok(h&&h.replicationNetworkReconnected===true&&
    h.receiverRunning===true&&h.applierRunning===true&&
    h.catchupResult===0&&h.originalTokenCount===1&&
    h.partitionTokenCount===1&&h.replicaStillSuperReadOnly===true&&
    h.sourceStillWritable===true,
    'Healing must restore GTID continuity without two writable nodes');
  assert.ok(report.cleanup?.isolatedFixturesDisposed===true&&
    Number.isFinite(report.elapsedMs)&&report.elapsedMs>0,
    'Incomplete disposable fixture cleanup');
  return Object.freeze({
    schemaVersion:1,kind:'mysql-gtid-network-partition-decision',
    status:'passed',revision,runId,version,
    partitionObserved:true,gtidLagObserved:true,
    unsafePromotionBlocked:true,replicaWrites:0,replayedWrites:0,
    gtidsCaughtUpAfterHealing:true,simultaneousWritableNodes:1,
    isolatedFixturesDisposed:true
  });
}
