import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateEpochAdmission,validateEpochEvidence}
  from './fencing-epoch-evidence.mjs';

const revision='a'.repeat(40),runId='12345';
const context={revision,runId,version:'8.4.13'};
const fixture=()=>({
  schemaVersion:1,kind:'mysql-transactional-fencing-epoch',
  status:'passed',failureCode:null,revision,runId,
  environment:{ci:true,node:'v22.23.0',platform:'linux',arch:'x64',
    serverImage:'mysql:8.4.13',serverVersion:'8.4.13',
    transport:'verified-tls',distinctRestrictedPrincipals:true,
    mysqlEnforcedRoutine:true},
  fencing:{initialEpoch:1,initialHolderWrite:1,
    wrongHolderRejected:true,futureEpochRejected:true,
    readAccessDenied:true,directWriteDenied:true,
    epochAdvanceCAS:1,previousHolderRejected:true,
    oldEpochNewHolderRejected:true,newHolderWrite:1,
    impersonationRejected:true,staleAdminCAS:0,
    duplicateOperationRejected:true,competingAdvances:2,
    competingCASWinners:1,finalEpoch:3,
    finalEpochWriterAccepted:true,staleEpochWriterRejected:true,
    totalSuccessfulOperationTokens:3,automaticReplays:0},
  restart:{serverRestarted:true,persistedEpoch:3,
    staleWriterRejected:true,currentWriterAccepted:true,
    totalSuccessfulOperationTokensAfterRestart:4},
  cleanup:{fixtureDropped:true,principalsRemoved:true,mysqlRestored:true},
  elapsedMs:45000
});
const reject=change=>{
  const r=fixture();change(r);
  assert.throws(()=>validateEpochEvidence(r,context));
};
test('epoch admission is fail-closed for stale, future and impersonating holders',()=>{
  const base={currentEpoch:2,requestedEpoch:2,
    currentHolder:'node_a',authenticatedHolder:'node_a'};
  assert.deepEqual(evaluateEpochAdmission(base),
    {admitted:true,reason:'current-authority'});
  for(const value of [1,3]){
    assert.deepEqual(evaluateEpochAdmission({...base,requestedEpoch:value}),
      {admitted:false,reason:'stale-or-future-epoch'});
  }
  assert.deepEqual(evaluateEpochAdmission({...base,authenticatedHolder:'node_b'}),
    {admitted:false,reason:'wrong-holder'});
  for(const value of [0,-1,2.5,Number.MAX_SAFE_INTEGER+1])
    assert.throws(()=>evaluateEpochAdmission({...base,requestedEpoch:value}));
  assert.throws(()=>evaluateEpochAdmission({...base,currentHolder:'root@%'}));
});
test('valid MySQL server-checked epoch report preserves independent evidence',()=>{
  const decision=validateEpochEvidence(fixture(),context);
  assert.equal(decision.concurrentAdvanceWinners,1);
  assert.equal(decision.epochPersistedAcrossRestart,true);
  assert.equal(decision.impersonationDenied,true);
  assert.equal(decision.productionConsensusQualified,false);
  assert.ok(Object.isFrozen(decision));
  assert.equal(JSON.stringify(decision).includes('password'),false);
});
test('reject foreign run and non-TLS, unqualified or aliased principals',()=>{
  assert.throws(()=>validateEpochEvidence(fixture(),{...context,runId:'999'}));
  assert.throws(()=>validateEpochEvidence(fixture(),{
    ...context,revision:'b'.repeat(40)}));
  reject(r=>{r.status='failed';});
  reject(r=>{r.environment.transport='isolated-local';});
  reject(r=>{r.environment.node='v24.0.0';});
  reject(r=>{r.environment.serverImage='mysql:latest';});
  reject(r=>{r.environment.distinctRestrictedPrincipals=false;});
  reject(r=>{r.environment.mysqlEnforcedRoutine=false;});
});
test('reject premature admission, forged current identity or defeated CAS',()=>{
  for(const name of ['wrongHolderRejected','futureEpochRejected',
    'readAccessDenied','directWriteDenied','previousHolderRejected',
    'oldEpochNewHolderRejected','impersonationRejected',
    'duplicateOperationRejected','finalEpochWriterAccepted',
    'staleEpochWriterRejected'])
    reject(r=>{r.fencing[name]=false;});
  reject(r=>{r.fencing.epochAdvanceCAS=0;});
  reject(r=>{r.fencing.staleAdminCAS=1;});
  reject(r=>{r.fencing.competingCASWinners=2;});
  reject(r=>{r.fencing.finalEpoch=2;});
  reject(r=>{r.fencing.totalSuccessfulOperationTokens=4;});
  reject(r=>{r.fencing.automaticReplays=1;});
});
test('reject lost epoch after restart, replays and cleanup gaps',()=>{
  reject(r=>{r.restart.serverRestarted=false;});
  reject(r=>{r.restart.persistedEpoch=2;});
  reject(r=>{r.restart.staleWriterRejected=false;});
  reject(r=>{r.restart.currentWriterAccepted=false;});
  reject(r=>{r.restart.totalSuccessfulOperationTokensAfterRestart=3;});
  reject(r=>{r.cleanup.fixtureDropped=false;});
  reject(r=>{r.cleanup.principalsRemoved=false;});
  reject(r=>{r.cleanup.mysqlRestored=false;});
  reject(r=>{r.elapsedMs=Infinity;});
});
