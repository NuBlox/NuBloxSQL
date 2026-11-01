#!/usr/bin/env node
/** Validate one original, bounded, same-revision MySQL fencing epoch report. */
import assert from 'node:assert/strict';
import {readFileSync,statSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {validateEpochEvidence} from './fencing-epoch-evidence.mjs';
try{
  assert.equal(process.argv.length,3);
  const runId=process.env.GITHUB_RUN_ID;
  assert.match(runId??'',/^[0-9]+$/);
  const dir=resolve(process.argv[2]),filename='mysql-fencing-epoch-'+runId+'.json';
  assert.deepEqual(readdirSync(dir),[filename],
    'Only one same-run original artifact may be accepted');
  const source=join(dir,filename);
  assert.ok(statSync(source).isFile()&&statSync(source).size<=64*1024);
  const report=JSON.parse(readFileSync(source,'utf8'));
  const decision=validateEpochEvidence(report,{
    revision:process.env.GITHUB_SHA,runId,version:'8.4.13'
  });
  const output=resolve('artifacts/qualification-matrix');
  mkdirSync(output,{recursive:true});
  writeFileSync(join(output,'mysql-fencing-epoch-decision-'+runId+'.json'),
    JSON.stringify(decision,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(decision));
}catch{
  console.error('MySQL durable fencing epoch evidence failed strict acceptance');
  process.exitCode=1;
}
