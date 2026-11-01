#!/usr/bin/env node
/** Independently verify one exact run artifact from a two-node CI cutover. */
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {validateTwoNodeCutoverEvidence} from './two-node-cutover-evidence.mjs';

try{
  assert.equal(process.argv.length,3);
  const id=process.env.GITHUB_RUN_ID;
  assert.match(id??'',/^[0-9]+$/);
  const directory=resolve(process.argv[2]);
  const names=readdirSync(directory);
  assert.deepEqual(names,['mysql-two-node-cutover-'+id+'.json'],
    'Exactly one original same-run report required');
  const source=join(directory,names[0]);
  assert.ok(statSync(source).isFile()&&statSync(source).size<=64*1024);
  const report=JSON.parse(readFileSync(source,'utf8'));
  const decision=validateTwoNodeCutoverEvidence(report,{
    revision:process.env.GITHUB_SHA,runId:id,version:'8.4.13'
  });
  const out=resolve('artifacts/qualification-matrix');
  mkdirSync(out,{recursive:true});
  writeFileSync(join(out,'mysql-two-node-cutover-decision-'+id+'.json'),
    JSON.stringify(decision,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(decision));
}catch{
  console.error('Two-node cutover evidence did not meet safety acceptance criteria');
  process.exitCode=1;
}
