/** Release preflight: validate *actual npm pack* contents, not just src layout.
 * This does not publish, sign, license a customer, or assert production support.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectManifest,inspectPacklist,inspectRuntimeImports} from './verify-core.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const pkgDir=resolve(root,'packages/driver');
const manifest=JSON.parse(readFileSync(resolve(pkgDir,'package.json'),'utf8'));
const license=readFileSync(resolve(pkgDir,'LICENSE'),'utf8');
assert.equal(license,readFileSync(resolve(root,'LICENSE'),'utf8'),
  'Published proprietary LICENSE must exactly match root ownership and terms');
inspectManifest(manifest);

const result=JSON.parse(execFileSync(
  process.platform==='win32'?'npm.cmd':'npm',
  ['pack','--json','--dry-run','--workspace','@nublox/driver'],
  {cwd:root,encoding:'utf8',maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']}
));
assert.equal(result.length,1,'Expected a single workspace package');
const tarball=result[0];
assert.equal(tarball.name,manifest.name);
assert.equal(tarball.version,manifest.version);
const files=tarball.files;
inspectPacklist(files);
const distFiles=files.filter(f=>f.path.startsWith('dist/')&&f.path.endsWith('.js'));
for(const file of distFiles){
  const source=readFileSync(resolve(pkgDir,file.path),'utf8');
  inspectRuntimeImports(source,file.path);
}
const report={
  schemaVersion:1,kind:'release-package-preflight',status:'passed',
  package:manifest.name,version:manifest.version,
  node:process.version,revision:process.env.GITHUB_SHA??null,
  licenseSha256:createHash('sha256').update(license).digest('hex'),
  fileCount:files.length,unpackedSize:tarball.unpackedSize,
  packageIntegrity:tarball.integrity,hashAlgorithm:'sha512',
  runtimeDependencies:0,
  testFixturesIncluded:false,
  publicationPerformed:false
};
const directory=resolve(root,'artifacts/release');
mkdirSync(directory,{recursive:true});
writeFileSync(resolve(directory,'preflight.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(report,null,2));
