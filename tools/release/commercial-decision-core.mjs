/**
 * Fail-closed, pre-commercial decision contract.
 * This validator only recognises an explicitly blocked engineering preview.
 * A future production validator must independently verify signed approvals,
 * support obligations and evidence, not trust booleans checked into Git.
 */
import assert from 'node:assert/strict';

const ownKeys=(value,keys,label)=>{
  assert.ok(value&&typeof value==='object'&&!Array.isArray(value),label+' must be an object');
  assert.deepEqual(Object.keys(value).sort(),[...keys].sort(),label+' has missing or unexpected fields');
};
const gates=Array.from({length:11},(_,index)=>`G${index+1}`);

export function inspectCommercialDecision(decision,manifest,{requireProduction=false}={}){
  ownKeys(manifest,['name','version'],'Package identity');
  assert.equal(manifest.name,'@nublox/driver');
  assert.match(manifest.version,/^\d+\.\d+\.\d+-dev\.\d+$/,
    'Only an unpublished development package can pass the preview gate');
  ownKeys(decision,[
    'schemaVersion','package','candidateVersion','classification','decision',
    'evaluationAuthorized','productionAuthorized','publicationAuthorized',
    'proposedProfile','approvedProfiles','gates','approvals','trackingIssue'
  ],'Commercial decision');
  assert.equal(decision.schemaVersion,1);
  assert.equal(decision.package,manifest.name);
  assert.equal(decision.candidateVersion,manifest.version);
  assert.equal(decision.classification,'engineering-preview');
  assert.equal(decision.decision,'blocked',
    'Production approval cannot be asserted by editing a repository manifest');
  for(const field of ['evaluationAuthorized','productionAuthorized','publicationAuthorized']){
    assert.equal(decision[field],false,field+' must be explicitly denied');
  }
  ownKeys(decision.proposedProfile,
    ['vendor','serverVersion','nodeMajor','platform','transport'],'Proposed profile');
  assert.deepEqual(decision.proposedProfile,{
    vendor:'mysql',serverVersion:'8.4.13',nodeMajor:22,
    platform:'linux-x64',transport:'verified-tls'
  },'The exact proposed pilot profile must be reviewed before changing');
  assert.deepEqual(decision.approvedProfiles,[],
    'No customer deployment profile is authorised in the engineering preview');
  assert.ok(Array.isArray(decision.gates)&&decision.gates.length===gates.length,
    'Every G1-G11 release gate must be present');
  for(let i=0;i<gates.length;i++){
    ownKeys(decision.gates[i],['id','status'],`Gate ${i+1}`);
    assert.equal(decision.gates[i].id,gates[i],'Release gates must remain complete and ordered');
    assert.equal(decision.gates[i].status,'pending',
      'A release gate cannot be self-certified through the preview manifest');
  }
  ownKeys(decision.approvals,
    ['productOwner','independentSecurity','legal','supportOperations'],'Approvals');
  for(const [owner,status] of Object.entries(decision.approvals)){
    assert.equal(status,'pending',owner+' approval requires external signed evidence');
  }
  assert.equal(decision.trackingIssue,'https://github.com/NuBlox/NuBloxSQL/issues/421');
  if(requireProduction)assert.fail('Commercial production release DENIED: external reviewed evidence and signed approvals are missing');
  return Object.freeze({
    schemaVersion:1,kind:'commercial-release-decision',status:'blocked',
    package:decision.package,version:decision.candidateVersion,
    proposedProfile:decision.proposedProfile,approvedProfiles:0,
    gatesPending:gates.length,approvalsPending:4,
    evaluationAuthorized:false,productionAuthorized:false,publicationAuthorized:false,
    trackingIssue:decision.trackingIssue
  });
}
