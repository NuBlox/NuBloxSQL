#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {selectWriteSoakReport,validateWriteSoakEvidence} from './write-soak-evidence.mjs';

try{
  assert.equal(process.argv.length,3,'Artifact directory required');
  const directory=resolve(process.argv[2]),runId=process.env.GITHUB_RUN_ID;
  const filename=join(directory,selectWriteSoakReport(readdirSync(directory),runId));
  assert.ok(statSync(filename).isFile()&&statSync(filename).size<=256*1024);
  const decision=validateWriteSoakEvidence(JSON.parse(readFileSync(filename,'utf8')),{
    revision:process.env.GITHUB_SHA,runId,event:process.env.GITHUB_EVENT_NAME,
    hours:process.env.NUBLOX_ENDURANCE_HOURS
  });
  const dir=resolve('artifacts/qualification-matrix');
  mkdirSync(dir,{recursive:true});
  writeFileSync(join(dir,'mysql-write-soak-decision-'+runId+'.json'),
    JSON.stringify(decision,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(decision));
}catch{
  console.error('Independent MySQL write-soak evidence verification failed');
  process.exitCode=1;
}
