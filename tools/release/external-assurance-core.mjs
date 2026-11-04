/**
 * Fail-closed pre-commercial external-assurance INTAKE validation.
 * A valid report proves only that reviewer briefs reference real source files
 * and contain NO appointment, independent audit or authorisation claims.
 * It never validates external signatures or grants release permissions.
 */
import assert from 'node:assert/strict';

const requiredGates=Array.from({length:11},(_,i)=>'G'+(i+1));
const requiredWorkstreams=[
  ['security',['G3','G4']],
  ['database-engineering',['G1','G2','G4','G6','G8','G11']],
  ['benchmarking',['G5']],
  ['legal',['G10']],
  ['operations',['G9','G11']],
  ['release-governance',['G7','G8','G9','G10']]
];
const exact=(item,expected,label)=>{
  assert.ok(item&&typeof item==='object'&&!Array.isArray(item),
    label+' must be a plain object');
  assert.deepEqual(Object.keys(item).sort(),expected.slice().sort(),
    label+' has missing or unexpected fields');
};
const isSafeSourcePath=value=>
  typeof value==='string'&&
  /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(value)&&
  !value.split('/').some(part=>part==='.'||part==='..');

export function inspectExternalAssuranceIntake(
  intake,decision,manifest,{sourceExists}={}
){
  exact(manifest,['name','version'],'Package manifest');
  exact(decision.proposedProfile,
    ['vendor','serverVersion','nodeMajor','platform','transport'],
    'Commercial proposed profile');
  assert.equal(decision.decision,'blocked',
    'A preparation intake cannot accompany an approved commercial decision');
  assert.equal(decision.productionAuthorized,false);
  assert.equal(decision.evaluationAuthorized,false);
  assert.equal(decision.publicationAuthorized,false);
  exact(intake,[
    'schemaVersion','kind','status','package','proposedProfile','candidate',
    'rights','workstreams','gates','trackingIssue'
  ],'External assurance intake');
  assert.equal(intake.schemaVersion,1);
  assert.equal(intake.kind,'nubloxsql-external-assurance-intake');
  assert.equal(intake.status,'preparation-only');
  exact(intake.package,['name','version'],'External assurance package');
  assert.deepEqual(intake.package,manifest);
  assert.equal(intake.package.name,'@nublox/driver');
  assert.match(intake.package.version,/^\d+\.\d+\.\d+-dev\.\d+$/,
    'External assurance cannot silently claim a stable package');
  assert.deepEqual(intake.proposedProfile,decision.proposedProfile,
    'Proposed reviewer scope must match blocked commercial manifest');

  exact(intake.candidate,['sourceRevision','packageSha256','frozen'],
    'Release candidate selection');
  assert.equal(intake.candidate.sourceRevision,null,
    'Source candidate not yet frozen: never infer a reviewed revision');
  assert.equal(intake.candidate.packageSha256,null,
    'No tarball digest can be attributed to an uncommissioned review');
  assert.equal(intake.candidate.frozen,false);
  exact(intake.rights,
    ['evaluationAuthorized','productionAuthorized','publicationAuthorized'],
    'External assurance rights');
  for(const field of Object.keys(intake.rights)){
    assert.equal(intake.rights[field],false,
      'External assurance intake cannot grant customer rights');
  }

  assert.ok(Array.isArray(intake.workstreams)&&
    intake.workstreams.length===requiredWorkstreams.length,
    'All independent and owner review workstreams must be present');
  const coveredGates=new Set();
  requiredWorkstreams.forEach(([id,gates],i)=>{
    const stream=intake.workstreams[i];
    exact(stream,['id','gates','status','assessor','contractRef','reportRef'],
      'Assessment workstream');
    assert.equal(stream.id,id,'Assessment workstreams must be complete and ordered');
    assert.deepEqual(stream.gates,gates,'Assessment gate coverage changed');
    gates.forEach(gate=>coveredGates.add(gate));
    assert.equal(stream.status,'not-commissioned',
      'A reviewer cannot be appointed through an editable intake');
    assert.equal(stream.assessor,null);
    assert.equal(stream.contractRef,null);
    assert.equal(stream.reportRef,null);
  });
  assert.deepEqual([...coveredGates].sort(),requiredGates.slice().sort(),
    'Every commercial gate needs a proposed reviewer workstream');

  assert.ok(Array.isArray(intake.gates)&&intake.gates.length===11,
    'All G1–G11 evidence references must be present');
  let sourceReferences=0;
  intake.gates.forEach((gate,i)=>{
    exact(gate,[
      'id','status','sourcePaths','independentEvidenceRefs',
      'independentReviewer','reviewSignoffRef'
    ],'Assurance gate');
    assert.equal(gate.id,requiredGates[i],
      'Every G1–G11 gate must be complete and ordered');
    assert.equal(gate.status,'pending-external-review',
      'Intake cannot assert independent assurance');
    assert.deepEqual(gate.independentEvidenceRefs,[]);
    assert.equal(gate.independentReviewer,null);
    assert.equal(gate.reviewSignoffRef,null);
    assert.ok(Array.isArray(gate.sourcePaths)&&gate.sourcePaths.length>=1,
      'Every gate must reference real engineering source material');
    assert.equal(new Set(gate.sourcePaths).size,gate.sourcePaths.length,
      'Source references must not be duplicated within a gate');
    gate.sourcePaths.forEach(path=>{
      assert.ok(isSafeSourcePath(path),'Unsafe assurance source path');
      if(sourceExists)assert.ok(sourceExists(path),
        'Missing referenced engineering file: '+path);
      sourceReferences++;
    });
  });
  assert.equal(intake.trackingIssue,
    'https://github.com/NuBlox/NuBloxSQL/issues/421');

  return Object.freeze({
    schemaVersion:1,kind:'external-assurance-intake-check',
    status:'preparation-only',package:intake.package.name,
    version:intake.package.version,
    gatesPending:requiredGates.length,
    workstreamsNotCommissioned:requiredWorkstreams.length,
    engineeringSourceReferences:sourceReferences,
    independentAssessmentsVerified:0,
    evaluationAuthorized:false,productionAuthorized:false,
    publicationAuthorized:false,
    trackingIssue:intake.trackingIssue
  });
}
