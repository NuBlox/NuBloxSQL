import assert from 'node:assert/strict';

/** A live endpoint is not proof of a replicated, safe primary.
 * This test intentionally supplies an unreplicated secondary and verifies
 * that explicit cutover refuses to resume writes. Not a general HA router. */
export function assessTwoNodeCutover({primaryCommitted,standbyHasToken}){
  assert.equal(typeof primaryCommitted,'boolean');
  assert.equal(typeof standbyHasToken,'boolean');
  return Object.freeze({
    healthIsNotReplication:true,
    decision:'blocked-unverified-replication',
    resumeWrites:false,
    replayOriginalWrite:false,
    reason:!primaryCommitted?'primary-commit-unverified':
      !standbyHasToken?'committed-token-missing-on-standby':
      'no-replication-or-promotion-authority'
  });
}

export function validateTwoNodeCutoverEvidence(report,{
  revision,runId,version='8.4.13'
}={}){
  assert.match(revision??'',/^[a-f0-9]{40}$/);
  assert.match(runId??'',/^[0-9]+$/);
  assert.equal(version,'8.4.13');
  assert.ok(report&&typeof report==='object'&&
    report.schemaVersion===1&&report.kind==='mysql-two-node-cutover'&&
    report.status==='passed'&&report.failureCode===null&&
    report.revision===revision&&report.runId===runId,
    'Exact successful original report required');
  const e=report.environment;
  assert.ok(e&&e.ci===true&&e.platform==='linux'&&e.arch==='x64'&&
    /^v22\./.test(e.node??'')&&
    e.primaryImage==='mysql:8.4.13'&&
    e.standbyImage==='mysql:8.4.13'&&
    e.primaryVersion===version&&e.standbyVersion===version&&
    e.distinctServerIdentities===true&&e.transport==='isolated-local',
    'Wrong fixture, versions or endpoint identities');
  const o=report.outcome;
  assert.ok(o&&o.primaryCommittedBeforeCrash===true&&
    o.primaryKilled===true&&o.inflightQueryInterrupted===true&&
    o.oldPoolDiscarded===true&&
    o.standbyReachableAfterCrash===true&&
    o.standbyCommittedTokenCount===0&&
    o.primaryCommittedTokenCountAfterRestart===1&&
    o.primaryRestored===true&&
    o.originalWriteExecutions===1&&o.originalWriteReplays===0&&
    o.standbyWriteExecutions===0&&o.promotionAttempts===0&&
    o.cutoverDecision==='blocked-unverified-replication'&&
    o.resumeWrites===false,
    'Must block unreplicated cutover without replay or promotion');
  const r=report.resources;
  assert.ok(r&&Number.isSafeInteger(r.primaryPoolCreated)&&
    r.primaryPoolCreated>=1&&
    Number.isSafeInteger(r.primaryPoolDiscarded)&&
    r.primaryPoolDiscarded>=1&&
    r.primaryPoolAfterClose===0&&r.pendingAfterClose===0&&
    report.cleanup?.primaryTableDropped===true&&
    report.cleanup?.standbyTableDropped===true&&
    report.cleanup?.primaryServerHealthy===true&&
    typeof report.elapsedMs==='number'&&
    Number.isFinite(report.elapsedMs)&&report.elapsedMs>0,
    'Pool or disposable service was not cleaned up');
  return Object.freeze({
    schemaVersion:1,kind:'mysql-two-node-cutover-decision',status:'passed',
    revision,runId,version,primaryCrashCount:1,
    verifiedIndependentNodes:2,
    originalWrites:1,originalWriteReplays:0,standbyWrites:0,
    cutoverDecision:'blocked-unverified-replication',resumeWrites:false,
    primaryPoolSlotsAfterClose:0
  });
}
