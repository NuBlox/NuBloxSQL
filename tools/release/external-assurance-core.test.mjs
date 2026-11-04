import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectExternalAssuranceIntake} from './external-assurance-core.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const fixture=JSON.parse(readFileSync(resolve(root,
  'docs/assurance/external-assurance-intake.json'),'utf8'));
const decision=JSON.parse(readFileSync(resolve(root,
  'docs/release/mysql-commercial-decision.json'),'utf8'));
const manifest={name:'@nublox/driver',version:'0.1.0-dev.0'};
const check=(
  value=structuredClone(fixture),
  release=structuredClone(decision),
  packageIdentity=manifest
)=>inspectExternalAssuranceIntake(value,release,packageIdentity,{
  sourceExists:path=>existsSync(resolve(root,path))
});

test('assurance intake is complete, linked to real source and explicitly NOT approved',()=>{
  const result=check();
  assert.equal(result.status,'preparation-only');
  assert.equal(result.gatesPending,11);
  assert.equal(result.workstreamsNotCommissioned,6);
  assert.ok(result.engineeringSourceReferences>=20);
  assert.equal(result.independentAssessmentsVerified,0);
  assert.equal(result.evaluationAuthorized,false);
  assert.equal(result.productionAuthorized,false);
  assert.equal(result.publicationAuthorized,false);
  assert.ok(Object.isFrozen(result));
});

test('false independent signoff, appointment, licensing or source freeze is rejected',()=>{
  const mutations=[
    d=>{d.status='externally-certified';},
    d=>{d.rights.evaluationAuthorized=true;},
    d=>{d.rights.productionAuthorized=true;},
    d=>{d.rights.publicationAuthorized=true;},
    d=>{d.candidate.frozen=true;},
    d=>{d.candidate.sourceRevision='a'.repeat(40);},
    d=>{d.candidate.packageSha256='b'.repeat(64);},
    d=>{d.workstreams[0].status='approved';},
    d=>{d.workstreams[0].assessor='Invented Assessor';},
    d=>{d.workstreams[1].contractRef='fictional-contract';},
    d=>{d.workstreams[2].reportRef='fake-report.pdf';},
    d=>{d.gates[0].status='passed';},
    d=>{d.gates[0].independentReviewer='fake-reviewer';},
    d=>{d.gates[1].independentEvidenceRefs.push('fake-certificate');},
    d=>{d.gates[2].reviewSignoffRef='fake-signature';},
    d=>{d.finalDecision='approved';}
  ];
  for(const mutate of mutations){
    const copy=structuredClone(fixture);
    mutate(copy);
    assert.throws(()=>check(copy));
  }
});

test('missing, duplicate, fabricated or traversal source evidence fails',()=>{
  const mutations=[
    d=>{d.gates.pop();},
    d=>{d.gates[1].id='G1';},
    d=>{d.gates.reverse();},
    d=>{d.gates[4].sourcePaths=[];},
    d=>{d.gates[4].sourcePaths.push(d.gates[4].sourcePaths[0]);},
    d=>{d.gates[5].sourcePaths[0]='../secret';},
    d=>{d.gates[7].sourcePaths[0]='docs/MISSING-REVIEW.txt';},
    d=>{d.workstreams.splice(2,1);},
    d=>{d.workstreams[0].gates=[];},
    d=>{d.trackingIssue='https://example.invalid/approved';},
    d=>{d.proposedProfile.serverVersion='9.7.4';},
    d=>{d.package.version='1.0.0';}
  ];
  for(const mutate of mutations){
    const copy=structuredClone(fixture);
    mutate(copy);
    assert.throws(()=>check(copy));
  }
});

test('assurance must match the blocked commercial release identity',()=>{
  assert.throws(()=>check(undefined,{
    ...decision,decision:'approved'
  }));
  assert.throws(()=>check(undefined,{
    ...decision,productionAuthorized:true
  }));
  assert.throws(()=>check(undefined,undefined,{
    name:'@nublox/driver',version:'0.1.0-dev.1'
  }));
});
