#!/usr/bin/env node
/** Opt-in mixed native MySQL qualification against a disposable loopback fixture.
 * Reports numeric process observations only: no SQL, row data or credentials.
 */
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {platform,arch} from 'node:os';
import {createDatabasePool} from '../../packages/driver/dist/index.js';
import {parseMixedOptions,runMixedWorkloads} from './mixed-workloads.mjs';
import {safeError} from './metrics.mjs';

const options=parseMixedOptions(process.argv.slice(2));
if(process.env.NUBLOX_LIVE_MYSQL!=='1')
  throw Error('Explicit disposable native MySQL fixture opt-in is required');
const target={
  engine:'mysql',host:'127.0.0.1',
  port:Number(process.env.MYSQL_PORT??3306),
  user:process.env.MYSQL_USER??'root',
  password:process.env.MYSQL_PASSWORD??'test-password',
  database:process.env.MYSQL_DATABASE??'nublox_test',
  security:'isolated-local',timeoutMs:30000
};
const report={
  schemaVersion:1,kind:'mysql-mixed-workload',status:'running',
  environment:{
    revision:process.env.GITHUB_SHA??null,
    runId:process.env.GITHUB_RUN_ID??null,
    ci:Boolean(process.env.CI),node:process.version,
    platform:platform(),arch:arch(),serverVersion:null,
    transport:'isolated-local'
  },
  options,workloads:null,errors:{unexpected:0,codes:[]},
  limitations:[
    'Read-only qualification, including deliberately rolled-back read transactions',
    'Process-level memory trend is not allocation attribution or proof of leak freedom',
    'Local isolated MySQL and runner hardware do not establish customer throughput or uptime'
  ]
};
try{
  const result=await runMixedWorkloads({
    createPool:createDatabasePool,target,options,
    expectedServerVersion:process.env.NUBLOX_QUALIFICATION_MYSQL_VERSION??null
  });
  report.environment.serverVersion=result.serverVersion;
  report.workloads=result;
  report.status='passed';
}catch(error){
  report.status='failed';
  report.errors.unexpected=1;
  report.errors.codes=[safeError(error)];
  process.exitCode=1;
}finally{
  const dir=resolve('artifacts/qualification');
  mkdirSync(dir,{recursive:true});
  const runId=String(process.env.GITHUB_RUN_ID??'local').replace(/[^A-Za-z0-9-]/g,'');
  const filename=resolve(dir,'mixed-workload-'+runId+'-'+Date.now()+'.json');
  writeFileSync(filename,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({
    report:filename,status:report.status,
    environment:report.environment,
    completed:report.workloads?.completedOperations??0,
    phases:report.workloads?.phases?.map(x=>({kind:x.kind,completed:x.count}))??[],
    errors:report.errors
  }));
}
