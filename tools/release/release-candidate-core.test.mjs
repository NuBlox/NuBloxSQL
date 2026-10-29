import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateReleaseCandidate} from './release-candidate-core.mjs';

const revision='a'.repeat(40),sha='f'.repeat(64),version='0.1.0-dev.0';
const input=()=>({
  filename:'nublox-driver-'+version+'.tgz',sizeBytes:24000,sha256:sha,
  revision,node:'v22.18.0',
  manifest:{name:'@nublox/driver',version},
  preflight:{status:'passed',kind:'release-package-preflight',
    revision,package:'@nublox/driver',version,runtimeDependencies:0,
    licenseSha256:sha,publicationPerformed:false},
  apiContract:{kind:'public-api-contract',status:'passed',
    revision,package:'@nublox/driver',version,compatibilityFixture:'passed',
    declarationSha256:sha,baselineSha256:sha,exports:21,
    publicationPerformed:false}
});

test('one exact unpublished tarball is tied to checked API, licence and commit',()=>{
  const report=validateReleaseCandidate(input());
  assert.equal(report.status,'passed');
  assert.equal(report.sha256,sha);
  assert.equal(report.publicationPerformed,false);
  assert.equal(report.signedProvenanceVerified,false,
    'A local digest never counts as signed GitHub provenance');
  assert.equal(report.apiBaselineSha256,sha);
});

test('unreviewed package, commit, digest, version and preflight never pass',()=>{
  const tests=[
    r=>{r.revision='b'.repeat(40);},
    r=>{r.sha256='invalid';},
    r=>{r.sizeBytes=0;},
    r=>{r.sizeBytes=9*1024*1024;},
    r=>{r.filename='nublox-driver-latest.tgz';},
    r=>{r.manifest.version='1.0.0';},
    r=>{r.preflight.revision='b'.repeat(40);},
    r=>{r.apiContract.revision='b'.repeat(40);},
    r=>{r.preflight.status='failed';},
    r=>{r.apiContract.status='failed';},
    r=>{r.apiContract.exports=22;},
    r=>{r.preflight.runtimeDependencies=1;},
    r=>{r.apiContract.compatibilityFixture='failed';},
    r=>{r.preflight.publicationPerformed=true;},
    r=>{r.apiContract.declarationSha256='bad';},
    r=>{r.node='v20.0.0';}
  ];
  for(const change of tests){
    const data=input();change(data);
    assert.throws(()=>validateReleaseCandidate(data));
  }
});
