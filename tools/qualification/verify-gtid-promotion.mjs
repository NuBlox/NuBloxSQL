#!/usr/bin/env node
/** Reject any duplicate, stale or inconsistent GTID promotion artifact. */
import assert from 'node:assert/strict';
import {readdirSync,statSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {validateFencedPromotionEvidence} from './gtid-promotion-evidence.mjs';

try{
  assert.equal(process.argv.length,3,'Expected one report directory');
  const runId=process.env.GITHUB_RUN_ID;
  assert.match(runId??'',/^[0-9]+$/);
  const dir=resolve(process.argv[2]);
  const expected='mysql-gtid-promotion-'+runId+'.json';
  assert.deepEqual(readdirSync(dir),[expected],'Require exact same-run original');
  const source=join(dir,expected);
  assert.ok(statSync(source).isFile()&&statSync(source).size<=64*1024);
  const report=JSON.parse(readFileSync(source,'utf8'));
  const decision=validateFencedPromotionEvidence(report,{
    revision:process.env.GITHUB_SHA,runId,version:'8.4.13'
  });
  const output=resolve('artifacts/qualification-matrix');
  mkdirSync(output,{recursive:true});
  writeFileSync(join(output,'mysql-gtid-promotion-decision-'+runId+'.json'),
    JSON.stringify(decision,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(decision));
}catch{
  console.error('GTID fenced-promotion evidence failed strict acceptance checks');
  process.exitCode=1;
}
