import assert from 'node:assert/strict';

/** Never turn a secondary into a writable primary from health alone.
 * The caller must separately provide evidence of fencing, GTID catch-up
 * and an explicit test/operator authorisation. Not a topology controller. */
export function assessFencedPromotion(state){
  assert.ok(state&&typeof state==='object');
  const fields=['primaryFenced','distinctServerIds','gtidAutoPosition',
    'gtidApplied','replicaReadOnly','committedTokenPresent',
    'operatorApproved','noDivergentWrites'];
  for(const field of fields)assert.equal(typeof state[field],'boolean',
    'Missing explicit promotion precondition: '+field);
  const missing=fields.filter(field=>!state[field]);
  return Object.freeze({
    allowed:missing.length===0,
    decision:missing.length===0?'qualified-test-promotion':'blocked',
    missing:Object.freeze(missing)
  });
}

export function validateFencedPromotionEvidence(report,{
  revision,runId,version='8.4.13'
}={}){
  assert.match(revision??'',/^[a-f0-9]{40}$/);
  assert.match(runId??'',/^[0-9]+$/);
  assert.equal(version,'8.4.13','Unapproved MySQL fixture');
  assert.ok(report&&typeof report==='object'&&
    report.schemaVersion===1&&report.kind==='mysql-gtid-fenced-promotion'&&
    report.status==='passed'&&report.failureCode===null&&
    report.revision===revision&&report.runId===runId,
    'Wrong run identity or qualification status');
  const e=report.environment;
  assert.ok(e&&e.ci===true&&e.node?.startsWith('v22.')&&
    e.platform==='linux'&&e.arch==='x64'&&
    e.primaryImage==='mysql:8.4.13'&&
    e.replicaImage==='mysql:8.4.13'&&
    e.primaryVersion===version&&e.replicaVersion===version&&
    e.distinctServerIds===true&&e.transport==='isolated-local',
    'Wrong or aliased MySQL test instances');
  const r=report.replication;
  assert.ok(r&&r.gtidModeOnBoth===true&&
    r.autoPosition===true&&r.replicaReadOnlyBefore===true&&
    r.sourceCommitAcknowledged===true&&
    r.appliedGtidWaitResult===0&&r.originalTokenOnReplica===1&&
    r.replicationReceiverRunning===true&&r.replicationApplierRunning===true,
    'Replication/catch-up prerequisite not independently confirmed');
  const p=report.promotion;
  assert.ok(p&&p.primaryKilled===true&&p.primaryFencedAtPromotion===true&&
    p.operatorApproved===true&&p.replicationStopped===true&&
    p.replicationConfigurationCleared===true&&
    p.replicaWritableAfterPromotion===true&&
    p.promotedWriteAcknowledged===true&&
    p.promotedTokenCount===1&&p.originalTokenCountAfterPromotion===1&&
    p.oldPrimaryRemainedDown===true&&p.noAutomaticReplay===true&&
    p.originalWriteExecutions===1&&p.promotedWriteExecutions===1&&
    p.promotionDecision==='qualified-test-promotion',
    'Incomplete fenced promotion, data integrity or replay proof');
  assert.ok(report.cleanup?.isolatedFixturesDisposed===true&&
    Number.isFinite(report.elapsedMs)&&report.elapsedMs>0,
    'Failure to clean up both disposable servers');
  return Object.freeze({
    schemaVersion:1,kind:'mysql-gtid-fenced-promotion-decision',
    status:'passed',revision,runId,version,
    replicaCaughtUp:true,primaryFenced:true,
    originalWrites:1,promotedWrites:1,automaticReplays:0,
    testPromotion:'qualified-test-promotion',
    isolatedFixturesDisposed:true
  });
}
