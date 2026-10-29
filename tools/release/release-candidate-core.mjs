/**
 * Pure validation for unpublished candidate tarballs.
 * GitHub's signed OIDC/Sigstore attestation is checked by the Actions
 * workflow, not inferred from this JSON report or a local SHA-256.
 */
import assert from 'node:assert/strict';

const hex=(value,length)=>typeof value==='string'&&
  new RegExp('^[0-9a-f]{'+length+'}$').test(value);
export function validateReleaseCandidate({filename,sizeBytes,sha256,revision,
  manifest,preflight,apiContract,node}){
  assert.ok(hex(revision,40),'A pinned commit is required for release provenance');
  assert.equal(manifest?.name,'@nublox/driver');
  assert.match(manifest.version??'',/^\d+\.\d+\.\d+-dev\.\d+$/);
  assert.equal(filename,`nublox-driver-${manifest.version}.tgz`,
    'Candidate tarball must have the exact package identity');
  assert.ok(Number.isSafeInteger(sizeBytes)&&sizeBytes>0&&sizeBytes<=8*1024*1024,
    'Candidate archive must be present and size-bounded');
  assert.ok(hex(sha256,64),'Candidate archive requires a SHA-256 digest');
  assert.equal(preflight?.status,'passed');
  assert.equal(preflight?.kind,'release-package-preflight');
  assert.equal(preflight?.revision,revision,'Preflight has a different commit');
  assert.equal(preflight?.package,manifest.name);
  assert.equal(preflight?.version,manifest.version);
  assert.equal(preflight?.runtimeDependencies,0);
  assert.equal(preflight?.publicationPerformed,false);
  assert.ok(hex(preflight?.licenseSha256,64));
  assert.equal(apiContract?.kind,'public-api-contract');
  assert.equal(apiContract?.status,'passed');
  assert.equal(apiContract?.revision,revision,'Public API gate has a different commit');
  assert.equal(apiContract?.package,manifest.name);
  assert.equal(apiContract?.version,manifest.version);
  assert.equal(apiContract?.compatibilityFixture,'passed');
  assert.equal(apiContract?.publicationPerformed,false);
  assert.ok(hex(apiContract?.declarationSha256,64));
  assert.ok(hex(apiContract?.baselineSha256,64));
  assert.equal(apiContract?.exports,21);
  assert.match(node??'',/^v22\./,'Release candidate builder must use Node 22');
  return Object.freeze({
    schemaVersion:1,kind:'unpublished-release-candidate',status:'passed',
    revision,package:manifest.name,version:manifest.version,
    filename,sizeBytes,sha256,node,
    publicApiDeclarationsSha256:apiContract.declarationSha256,
    apiBaselineSha256:apiContract.baselineSha256,
    licenseSha256:preflight.licenseSha256,
    runtimeDependencies:0,publicationPerformed:false,
    signedProvenanceVerified:false
  });
}
