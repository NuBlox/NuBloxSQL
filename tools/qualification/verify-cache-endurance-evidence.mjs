#!/usr/bin/env node
import assert from 'node:assert/strict';
import {openSync,readSync,closeSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {selectCacheEnduranceReport,validateCacheEnduranceEvidence}
  from './cache-endurance-evidence.mjs';

try{
  assert.equal(process.argv.length,3,'Original artifact directory required');
  const dir=resolve(process.argv[2]),runId=process.env.GITHUB_RUN_ID;
  const file=join(dir,selectCacheEnduranceReport(readdirSync(dir),runId));
  // Open the exact same file once and bound all bytes read. Checking a
  // pathname with statSync() before a separate readFileSync() creates a
  // TOCTOU race if the artifact is replaced between those operations.
  const limit=256*1024;
  const buffer=Buffer.allocUnsafe(limit+1);
  const fd=openSync(file,'r');
  let size=0;
  try{
    while(size<buffer.length){
      const count=readSync(fd,buffer,size,buffer.length-size,size);
      if(count===0)break;
      size+=count;
    }
  }finally{closeSync(fd);}
  assert.ok(size>0&&size<=limit,'Invalid or oversized original report');
  const decision=validateCacheEnduranceEvidence(
    JSON.parse(buffer.subarray(0,size).toString('utf8')),{
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
