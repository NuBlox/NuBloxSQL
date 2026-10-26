#!/usr/bin/env node
/**
 * Synthetic MySQL native-internals profiler. No network or database access,
 * no competitor dependency, no production runtime instrumentation.
 * Timings are diagnostic, with no fixed performance pass/fail thresholds.
 */
import {cpus,platform,arch} from 'node:os';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {profileInternalStages,profileOptions} from './internal-profile.mjs';
import {createInternalProfileStages} from './internal-stages.mjs';
import {safeError} from './metrics.mjs';

const args={};
for(const arg of process.argv.slice(2)){
  const match=/^--(iterations|rounds|queueDepth)=([0-9]+)$/.exec(arg);
  if(!match||Object.hasOwn(args,match[1]))
    throw Error('Invalid internal profiling CLI option');
  args[match[1]]=Number(match[2]);
}
const options=profileOptions(args);
let status='running',result=null,errors=[];
try{
  result=await profileInternalStages({
    options,stages:createInternalProfileStages()
  });
  status='passed';
}catch(error){
  status='failed';
  errors=[safeError(error)];
  process.exitCode=1;
}finally{
  const report={
    schemaVersion:1,status,
    environment:{
      timestamp:new Date().toISOString(),
      revision:process.env.GITHUB_SHA??null,
      node:process.version,platform:platform(),arch:arch(),
      cpuCount:cpus().length,ci:Boolean(process.env.CI)
    },
    result,errors
  };
  const root=resolve('artifacts/qualification');
  mkdirSync(root,{recursive:true});
  const id=String(process.env.GITHUB_RUN_ID??'local')
    .replace(/[^0-9A-Za-z-]/g,'');
  const path=resolve(root,`native-internal-profile-${id}-${Date.now()}.json`);
  writeFileSync(path,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({report:path,...report},null,2));
}
