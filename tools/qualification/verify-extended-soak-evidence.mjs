#!/usr/bin/env node
/** Independently check the one preserved extended-soak artifact from this run. */
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {validateExtendedSoakEvidence,selectExtendedSoakReport}
  from './extended-soak-evidence.mjs';

try{
  assert.equal(process.argv.length,3,'Require exactly one artifact directory');
  const directory=resolve(process.argv[2]);
  const runId=process.env.GITHUB_RUN_ID;
  const name=selectExtendedSoakReport(readdirSync(directory),runId);
  const file=join(directory,name);
  assert.ok(statSync(file).isFile()&&statSync(file).size<=256*1024,
    'Expected a bounded JSON report');
  const report=JSON.parse(readFileSync(file,'utf8'));
  const decision=validateExtendedSoakEvidence(report,{
    revision:process.env.GITHUB_SHA,
    runId,
    eventName:process.env.GITHUB_EVENT_NAME,
    hours:process.env.NUBLOX_ENDURANCE_HOURS
  });
  const output=resolve('artifacts/qualification-matrix');
  mkdirSync(output,{recursive:true});
  writeFileSync(join(output,'mysql-extended-soak-evidence-'+runId+'.json'),
    JSON.stringify(decision,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(decision));
}catch{
  // Do not print raw untrusted reports or error messages from JSON payloads.
  console.error('MySQL extended-soak evidence verification failed');
  process.exitCode=1;
}
