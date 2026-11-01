import assert from 'node:assert/strict';

/** Observer reachability is evidence of a network view, not leadership.
 * A hard fence alone cannot compensate for transactions missing on a
 * candidate. This is only a fail-closed qualification policy. */
export function assessAsymmetricPromotion({
  sourceHardFenced,gtidCaughtUp,observerViewsAgree,
  operatorApproved,replicaReadOnly
}={}){
  const fields={sourceHardFenced,gtidCaughtUp,observerViewsAgree,
    operatorApproved,replicaReadOnly};
  for(const [key,value] of Object.entries(fields))
    assert.equal(typeof value,'boolean','Missing '+key);
  const blocking=Object.entries({
    'source-not-hard-fenced':!sourceHardFenced,
    'source-gtid-missing':!gtidCaughtUp,
    'observer-views-disagree':!observerViewsAgree,
    'promotion-not-authorised':!operatorApproved,
    'candidate-not-read-only':!replicaReadOnly
  }).filter(([,blocked])=>blocked).map(([name])=>name);
  return Object.freeze({
    decision:'blocked', // a real controller must separately authorise.
    canPromote:false,
    canReplay:false,
    blocking:Object.freeze(blocking)
  });
}

export function validateAsymmetricFencingEvidence(r,{
  revision,runId,version='8.4.13'
}={}){
  assert.match(revision??'',/^[0-9a-f]{40}$/);
  assert.match(runId??'',/^[0-9]+$/);
  assert.equal(version,'8.4.13');
  assert.ok(r&&r.schemaVersion===1&&
    r.kind==='mysql-asymmetric-fencing'&&r.status==='passed'&&
    r.failureCode===null&&r.revision===revision&&r.runId===runId,
    'Invalid original run or status');
  const e=r.environment;
  assert.ok(e&&e.ci===true&&/^v22\./.test(e.node??'')&&
    e.platform==='linux'&&e.arch==='x64'&&
    e.sourceImage==='mysql:8.4.13'&&
    e.replicaImage==='mysql:8.4.13'&&
    e.sourceVersion===version&&e.replicaVersion===version&&
    e.distinctServerIds===true&&e.transport==='isolated-local',
    'Wrong disposable MySQL identities');
  const baseline=r.baseline;
  assert.ok(baseline&&baseline.gtidModeBoth===true&&
    baseline.replicationAutoPosition===true&&
    baseline.initialCatchupResult===0&&
    baseline.initialTokenOnReplica===1&&
    baseline.replicaSuperReadOnly===true,
    'GTID baseline not confirmed');
  const o=r.observers;
  assert.ok(o&&o.independentObserverNetworks===true&&
    o.sourceObserverCanReachSource===true&&
    o.sourceObserverCannotReachReplica===true&&
    o.replicaObserverCanReachReplica===true&&
    o.replicaObserverCannotReachSource===true&&
    o.reachabilityViewsConflict===true,
    'Missing asymmetric authenticated MySQL observer probes');
  const p=r.partition;
  assert.ok(p&&p.replicationNetworkDisconnected===true&&
    p.sourceReachable===true&&p.replicaReachable===true&&
    p.sourceWritable===true&&p.replicaSuperReadOnly===true&&
    p.primaryWriteExecutions===1&&p.standbyWriteExecutions===0&&
    p.standbyClientWriteRejected===true&&
    p.replicaMissingNewToken===true&&p.gtidWaitTimedOut===1&&
    p.sourceNotFenced===true&&p.promotionAttempts===0&&
    p.promotionDecision==='blocked'&&p.replayExecutions===0,
    'GTID lag or unsafe promotion observed during partition');
  const f=r.fencing;
  assert.ok(f&&f.adminWriteFencePersisted===true&&
    f.sourceClientWriteRejected===true&&
    f.writeFenceVerified===true&&
    f.hardKillVerified===true&&
    f.replicaStillLaggingAfterKill===true&&
    f.promotionBlockedEvenWhenSourceDead===true&&
    f.sourceRestartedHealthy===true&&
    f.persistedFenceAfterRestart===true&&
    f.sourceRestartWriteRejected===true&&
    f.noOriginalWriteReplay===true,
    'External kill and persisted source write fence not demonstrated');
  const h=r.healing;
  assert.ok(h&&h.replicationNetworkReconnected===true&&
    h.receiverRunning===true&&h.applierRunning===true&&
    h.catchupResult===0&&h.originalTokenCount===1&&
    h.partitionTokenCount===1&&
    h.replicaStillSuperReadOnly===true&&
    h.sourceStillSuperReadOnly===true&&
    h.simultaneouslyWritableSources===0,
    'GTID recovery or both read-only fences unverified');
  assert.ok(r.cleanup?.isolatedFixturesDisposed===true&&
    r.cleanup?.observerNetworksDisposed===true&&
    Number.isFinite(r.elapsedMs)&&r.elapsedMs>0,
    'Owned fixture cleanup incomplete');
  return Object.freeze({
    schemaVersion:1,kind:'mysql-asymmetric-fencing-decision',
    status:'passed',revision,runId,version,
    twoDivergentObserverViews:true,
    hardKillObserved:true,
    stalePromotionDenied:true,
    originalWrites:1,automaticReplays:0,standbyWrites:0,
    bothNodesReadOnlyAfterRecovery:true,
    healedGtidSetApplied:true,
    isolatedFixturesDisposed:true
  });
}
