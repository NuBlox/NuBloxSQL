#!/usr/bin/env node
/** Opt-in, read-only profile against a throwaway MySQL 8.4 fixture. */
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {platform,arch,cpus} from 'node:os';
import {connectDatabase,createDatabasePool} from '../../packages/driver/dist/index.js';
import {parseLiveOptions,profileLiveWorkloads} from './live-workloads.mjs';
import {safeError} from './metrics.mjs';

const options=parseLiveOptions(process.argv.slice(2));
const tls=process.env.NUBLOX_LIVE_MYSQL_TLS==='1';
if(process.env.NUBLOX_LIVE_MYSQL!=='1'&&!tls)
  throw Error('Explicit live MySQL fixture opt-in is required');
const target={
  engine:'mysql',host:'127.0.0.1',
  port:Number(process.env[tls?'MYSQL_TLS_PORT':'MYSQL_PORT']??(tls?3307:3306)),
  user:process.env.MYSQL_USER??'root',
  password:process.env.MYSQL_PASSWORD??'test-password',
  database:process.env.MYSQL_DATABASE??'nublox_test',
  security:tls?'verified-tls':'isolated-local',timeoutMs:30000
};
if(tls){
  target.ca=readFileSync(process.env.NUBLOX_TLS_CA_FILE,'utf8');
  target.serverName='localhost';
}
const report={
  schemaVersion:1,kind:'mysql-live-workload-profile',status:'running',
  environment:{
    timestamp:new Date().toISOString(),
    revision:process.env.GITHUB_SHA??null,
    node:process.version,platform:platform(),arch:arch(),cpuCount:cpus().length,
    serverVersion:null,transport:tls?'verified-tls':'isolated-local',
    ci:Boolean(process.env.CI)
  },
  options,workloads:{},resources:{},
  errors:{unexpected:0,codes:[]},
  limitations:[
    'Read-only isolated MySQL fixture; no production workload inference',
    'Memory high-water is process-wide and sampled; not per-query allocation attribution',
    'Shared host performance is noisy; no numeric pass-fail thresholds'
  ]
};
try{
  const result=await profileLiveWorkloads({
    connect:connectDatabase,createPool:createDatabasePool,target,options
  });
  report.environment.serverVersion=result.serverVersion;
  report.workloads=result.workloads;
  report.resources=result.resources;
  report.status='passed';
}catch(error){
  report.status='failed';
  report.errors.unexpected=1;
  report.errors.codes=[safeError(error)];
  process.exitCode=1;
}finally{
  const directory=resolve('artifacts/qualification');
  mkdirSync(directory,{recursive:true});
  const id=String(process.env.GITHUB_RUN_ID??'local').replace(/[^0-9A-Za-z-]/g,'');
  const path=resolve(directory,'mysql-live-workload-'+
    (tls?'tls':'local')+'-'+id+'-'+Date.now()+'.json');
  writeFileSync(path,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({report:path,status:report.status,
    environment:report.environment,workloads:report.workloads,
    resources:report.resources,errors:report.errors},null,2));
}
