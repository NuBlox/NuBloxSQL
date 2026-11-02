#!/usr/bin/env node
/** CI-only disposable write qualification: no customer SQL, rows or secrets in reports. */
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {platform,arch} from 'node:os';
import {connectDatabase,createDatabasePool} from '../../packages/driver/dist/index.js';
import {safeError} from './metrics.mjs';
import {parseWriteSoakOptions,checkWriteSoakEnvironment,runWriteSoak} from './write-soak.mjs';

const options=parseWriteSoakOptions(process.argv.slice(2));
const table=checkWriteSoakEnvironment(process.env);
const target={engine:'mysql',host:'127.0.0.1',port:3306,
  database:'nublox_test',security:'isolated-local',timeoutMs:30000,
  user:process.env.MYSQL_USER??'root',
  password:process.env.MYSQL_PASSWORD??'test-password'};
const report={schemaVersion:1,kind:'mysql-write-soak',status:'running',
  environment:{revision:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID,
    event:process.env.GITHUB_EVENT_NAME,node:process.version,
    platform:platform(),arch:arch(),ci:true,
    transport:'isolated-local',serverVersion:null},
  options,workload:null,errors:{unexpected:0,codes:[]}};
try{
  const workload=await runWriteSoak({
    connect:connectDatabase,createPool:createDatabasePool,
    target,table,options
  });
  report.workload=workload;
  report.environment.serverVersion=workload.serverVersion;
  report.status='passed';
}catch(error){
  process.exitCode=1;
  report.status='failed';
  report.errors.unexpected=1;
  report.errors.codes=[safeError(error)];
}finally{
  const output=resolve('artifacts/qualification');
  mkdirSync(output,{recursive:true});
  const file=resolve(output,'mysql-write-soak-'+process.env.GITHUB_RUN_ID+'.json');
  writeFileSync(file,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({
    kind:report.kind,status:report.status,report:file,
    elapsedMs:report.workload?.observedDurationMs??0,
    committed:report.workload?.committedTransactions??0,
    rolledBack:report.workload?.rolledBackTransactions??0,
    unexpectedErrors:report.errors.unexpected
  }));
}
