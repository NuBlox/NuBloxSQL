import assert from 'node:assert/strict';

/** Single-MySQL transactional fencing qualification. A separate trusted
 * elector is still required; a local epoch is not distributed consensus. */
export function evaluateEpochAdmission({
  currentEpoch,currentHolder,requestedEpoch,authenticatedHolder
}={}){
  for(const n of [currentEpoch,requestedEpoch])
    assert.ok(Number.isSafeInteger(n)&&n>=1,'Epoch must be positive and safe');
  for(const s of [currentHolder,authenticatedHolder])
    assert.ok(typeof s==='string'&&/^[a-z][a-z0-9_]{1,31}$/.test(s),
      'Authenticated MySQL identity required');
  const admitted=currentEpoch===requestedEpoch&&
    currentHolder===authenticatedHolder;
  return Object.freeze({admitted,reason:admitted?'current-authority':
    requestedEpoch!==currentEpoch?'stale-or-future-epoch':'wrong-holder'});
}

export function validateEpochEvidence(r,{revision,runId,version='8.4.13'}={}){
  assert.match(revision??'',/^[0-9a-f]{40}$/);
  assert.match(runId??'',/^[0-9]+$/);
  assert.equal(version,'8.4.13');
  assert.ok(r&&r.schemaVersion===1&&
    r.kind==='mysql-transactional-fencing-epoch'&&
    r.status==='passed'&&r.failureCode===null&&
    r.revision===revision&&r.runId===runId,
    'Wrong or failed source report');
  const env=r.environment;
  assert.ok(env&&env.ci===true&&/^v22\./.test(env.node??'')&&
    env.platform==='linux'&&env.arch==='x64'&&
    env.serverImage==='mysql:8.4.13'&&env.serverVersion===version&&
    env.transport==='verified-tls'&&env.distinctRestrictedPrincipals===true&&
    env.mysqlEnforcedRoutine===true,
    'Requires pinned verified-TLS, server-enforced least-privilege identities');
  const f=r.fencing;
  assert.ok(f&&f.initialEpoch===1&&
    f.initialHolderWrite===1&&
    f.wrongHolderRejected===true&&f.futureEpochRejected===true&&
    f.readAccessDenied===true&&f.directWriteDenied===true&&
    f.epochAdvanceCAS===1&&f.previousHolderRejected===true&&
    f.oldEpochNewHolderRejected===true&&
    f.newHolderWrite===1&&f.impersonationRejected===true&&
    f.staleAdminCAS===0&&f.duplicateOperationRejected===true&&
    f.competingAdvances===2&&f.competingCASWinners===1&&
    f.finalEpoch===3&&f.finalEpochWriterAccepted===true&&
    f.staleEpochWriterRejected===true&&
    f.totalSuccessfulOperationTokens===3&&
    f.automaticReplays===0,
    'Missing atomic epoch/identity enforcement or no-replay proof');
  const restart=r.restart;
  assert.ok(restart&&restart.serverRestarted===true&&
    restart.persistedEpoch===3&&restart.staleWriterRejected===true&&
    restart.currentWriterAccepted===true&&
    restart.totalSuccessfulOperationTokensAfterRestart===4,
    'Epoch must survive real MySQL restart and reject old authority');
  assert.ok(r.cleanup?.fixtureDropped===true&&
    r.cleanup?.principalsRemoved===true&&
    r.cleanup?.mysqlRestored===true&&
    Number.isFinite(r.elapsedMs)&&r.elapsedMs>0,
    'Cleanup or real-server restoration not verified');
  return Object.freeze({
    schemaVersion:1,kind:'mysql-fencing-epoch-decision',
    status:'passed',revision,runId,version,
    restrictedPrincipals:2,
    finalEpoch:3,concurrentAdvanceWinners:1,
    directWritesDenied:true,staleEpochDenied:true,
    impersonationDenied:true,epochPersistedAcrossRestart:true,
    acceptedOperationTokens:4,automaticReplays:0,
    productionConsensusQualified:false
  });
}
