import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectCommercialDecision} from './commercial-decision-core.mjs';
import {readFileSync} from 'node:fs';

const source=JSON.parse(readFileSync(new URL('../../docs/release/mysql-commercial-decision.json',import.meta.url)));
const manifest={name:'@nublox/driver',version:'0.1.0-dev.0'};
const data=()=>structuredClone(source);

test('preview decision is complete but explicitly denies publication and customer rights',()=>{
  const report=inspectCommercialDecision(data(),manifest);
  assert.deepEqual({status:report.status,gatesPending:report.gatesPending,
    approvalsPending:report.approvalsPending,productionAuthorized:report.productionAuthorized},
    {status:'blocked',gatesPending:11,approvalsPending:4,productionAuthorized:false});
  assert.throws(()=>inspectCommercialDecision(data(),manifest,{requireProduction:true}),
    /Commercial production release DENIED/);
});

test('manifest editing cannot falsely promote production, pilot or publishing rights',()=>{
  const mutations=[
    d=>{d.decision='approved';},
    d=>{d.classification='production';},
    d=>{d.evaluationAuthorized=true;},
    d=>{d.productionAuthorized=true;},
    d=>{d.publicationAuthorized=true;},
    d=>{d.approvedProfiles.push(d.proposedProfile);},
    d=>{d.approvals.productOwner='approved';},
    d=>{d.approvals.independentSecurity='approved';},
    d=>{d.gates[0].status='complete';},
    d=>{d.gates.pop();},
    d=>{d.gates[0].id='G2';},
    d=>{d.gates.reverse();},
    d=>{d.proposedProfile.serverVersion='26.10.0';},
    d=>{d.proposedProfile.transport='isolated-local';},
    d=>{d.trackingIssue='https://example.com/approved';},
    d=>{delete d.gates;},
    d=>{d.productionCertificate='self-approved';}
  ];
  for(const mutate of mutations){
    const draft=data();mutate(draft);
    assert.throws(()=>inspectCommercialDecision(draft,manifest));
  }
});

test('package version/identity cannot silently change under preview gate',()=>{
  for(const next of [
    {name:'@nublox/driver',version:'1.0.0'},
    {name:'@nublox/driver',version:'0.1.0-dev.1'},
    {name:'someone-else',version:'0.1.0-dev.0'}
  ])assert.throws(()=>inspectCommercialDecision(data(),next));
});
