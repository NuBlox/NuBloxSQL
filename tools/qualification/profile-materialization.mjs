#!/usr/bin/env node
/** Opt-in synthetic retained-result memory profile. No credentials or SQL. */
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {platform,arch} from 'node:os';
import {materializationProfileOptions,profileMaterialization} from './materialization-profile.mjs';

const input={};
for(const arg of process.argv.slice(2)){
  const match=/^--(rows|rounds|textBytes)=([0-9]+)$/.exec(arg);
  if(!match||Object.hasOwn(input,match[1]))
    throw Error('Invalid materialization profile CLI argument');
  input[match[1]]=Number(match[2]);
}
const options=materializationProfileOptions(input);
if(typeof global.gc!=='function')
  throw Error('Materialization profiling requires Node --expose-gc');

const report={
  ...profileMaterialization({options}),
  environment:{
    timestamp:new Date().toISOString(),
    revision:process.env.GITHUB_SHA??null,
    node:process.version,platform:platform(),arch:arch(),ci:Boolean(process.env.CI),
    gcEnabled:true
  }
};
const directory=resolve('artifacts/qualification');
mkdirSync(directory,{recursive:true});
const runId=String(process.env.GITHUB_RUN_ID??'local')
  .replace(/[^0-9A-Za-z-]/g,'');
const filename=resolve(directory,
  'mysql-materialization-memory-'+runId+'-'+Date.now()+'.json');
writeFileSync(filename,JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({report:filename,kind:report.kind,options:report.options,
  samples:report.samples,calibrationSummary:report.calibrationSummary,
  limitations:report.limitations},null,2));
