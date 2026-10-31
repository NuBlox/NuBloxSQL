#!/usr/bin/env node
/** Check one bounded, original crash report from the exact Actions run. */
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {validateCommitCrashEvidence} from './commit-crash-evidence.mjs';

try{
  assert.equal(process.argv.length,3,'Require exactly one evidence directory');
  const id=process.env.GITHUB_RUN_ID;
  assert.match(id??'',/^[0-9]+$/);
  const directory=resolve(process.argv[2]);
  const names=readdirSync(directory);
  assert.deepEqual(names,['mysql-commit-crash-'+id+'.json'],
    'Require exactly one same-run original report');
  const source=join(directory,names[0]);
  assert.ok(statSync(source).isFile()&&statSync(source).size<=64*1024,
    'Oversized or missing original crash report');
  const report=JSON.parse(readFileSync(source,'utf8'));
  const decision=validateCommitCrashEvidence(report,{
    revision:process.env.GITHUB_SHA,runId:id,version:'8.4.13'
  });
  const out=resolve('artifacts/qualification-matrix');
  mkdirSync(out,{recursive:true});
  writeFileSync(join(out,'mysql-commit-crash-decision-'+id+'.json'),
    JSON.stringify(decision,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(decision));
}catch{
  // Never print raw fixture values, remote errors or untrusted JSON content.
  console.error('MySQL COMMIT crash evidence did not meet acceptance criteria');
  process.exitCode=1;
}
