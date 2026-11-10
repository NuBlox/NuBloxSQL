#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {selectCacheEnduranceReport,validateCacheEnduranceEvidence}
  from './cache-endurance-evidence.mjs';

try{
  assert.equal(process.argv.length,3,'Original artifact directory required');
  const dir=resolve(process.argv[2]),runId=process.env.GITHUB_RUN_ID;
  const file=join(dir,selectCacheEnduranceReport(readdirSync(dir),runId));
  assert.ok(statSync(file).isFile()&&statSync(file).size<=256*1024,
    'Unbounded or missing original cache endurance artifact');
  const decision=validateCacheEnduranceEvidence(
    JSON.parse(readFileSync(file,'utf8')),{
      revision:process.env.GITHUB_SHA,runId,
      event:process.env.GITHUB_EVENT_NAME,
      minutes:process.env.NUBLOX_ENDURANCE_MINUTES
    });
  const target=resolve('artifacts/qualification-matrix');
  mkdirSync(target,{recursive:true});
  writeFileSync(join(target,'mysql-cache-endurance-tls-decision-'+runId+'.json'),
    JSON.stringify(decision,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(decision));
}catch{
  console.error('Independent cache endurance evidence verification failed');
  process.exitCode=1;
}
