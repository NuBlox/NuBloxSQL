#!/usr/bin/env node
/**
 * Pre-commercial public compatibility gate. Examines the actual entrypoint
 * and typechecks a strict consumer against emitted package declarations.
 * Does not sign, publish or grant a stable commercial API commitment.
 */
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {validatePublicApi} from './api-contract-core.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const pkg=resolve(root,'packages/driver');
const baseline=JSON.parse(readFileSync(resolve(root,'tools/release/public-api-baseline.json'),'utf8'));
const manifest=JSON.parse(readFileSync(resolve(pkg,'package.json'),'utf8'));
const source=readFileSync(resolve(pkg,'src/index.ts'),'utf8');
const result=validatePublicApi({source,baseline,manifest});
const compilerOptions={
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,
  moduleResolution:ts.ModuleResolutionKind.NodeNext,
  strict:true,noEmit:true,skipLibCheck:true,
  types:['node'],forceConsistentCasingInFileNames:true
};
const fixture=resolve(root,'tools/release/api-consumer.fixture.ts');
const program=ts.createProgram([fixture],compilerOptions);
const errors=ts.getPreEmitDiagnostics(program);
if(errors.length){
  const host={
    getCanonicalFileName:file=>file,getCurrentDirectory:()=>root,
    getNewLine:()=> '\n'
  };
  const formatted=ts.formatDiagnosticsWithColorAndContext(errors,host);
  // CI diagnostics identify source lines, not live SQL or credentials.
  console.error(formatted);
}
assert.equal(errors.length,0,
  'A strict TypeScript consumer no longer compiles against the published API');
const declaration=readFileSync(resolve(pkg,'dist/index.d.ts'),'utf8');
assert.match(declaration,/connectDatabase/,
  'Package declaration output must contain the public entrypoint');
const report={
  ...result,revision:process.env.GITHUB_SHA??null,node:process.version,
  declarationSha256:createHash('sha256').update(declaration).digest('hex'),
  baselineSha256:createHash('sha256').update(JSON.stringify(baseline)).digest('hex'),
  compatibilityFixture:'passed',publicationPerformed:false
};
const directory=resolve(root,'artifacts/release');
mkdirSync(directory,{recursive:true});
writeFileSync(resolve(directory,'public-api-contract.json'),
  JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(report,null,2));
