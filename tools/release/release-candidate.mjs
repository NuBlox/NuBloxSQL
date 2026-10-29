#!/usr/bin/env node
/** Validate the exact npm-pack tarball without ever publishing the package. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,writeFileSync,statSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateReleaseCandidate} from './release-candidate-core.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const out=resolve(root,'artifacts/release-candidate');
const candidates=readdirSync(out).filter(x=>x.endsWith('.tgz'));
assert.equal(candidates.length,1,'Require exactly one unpublished tarball');
const filename=candidates[0],archive=join(out,filename);
const manifest=JSON.parse(readFileSync(resolve(root,'packages/driver/package.json')));
const preflight=JSON.parse(readFileSync(resolve(root,'artifacts/release/preflight.json')));
const apiContract=JSON.parse(readFileSync(resolve(root,
  'artifacts/release/public-api-contract.json')));
const sha256=createHash('sha256').update(readFileSync(archive)).digest('hex');
const report=validateReleaseCandidate({
  filename,sizeBytes:statSync(archive).size,sha256,
  revision:process.env.GITHUB_SHA,manifest,preflight,apiContract,
  node:process.version
});
writeFileSync(join(out,'release-candidate.json'),
  JSON.stringify(report,null,2)+'\n',{mode:0o600});
writeFileSync(join(out,'SHA256SUMS'),sha256+'  '+filename+'\n',{mode:0o600});
console.log(JSON.stringify({kind:report.kind,status:report.status,
  filename,sha256,revision:report.revision,publicationPerformed:false}));
