#!/usr/bin/env node
/** Read-only isolated MySQL retention evidence, requiring explicit opt-in. */
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {platform,arch} from 'node:os';
import {connectDatabase} from '../../packages/driver/dist/index.js';
import {profileLiveRetention,liveRetentionOptions} from './live-retention.mjs';
import {safeError} from './metrics.mjs';

const raw={};
for(const arg of process.argv.slice(2)){
  const match=/^--(rows|rowBytes|rounds)=([0-9]+)$/.exec(arg);
  if(!match||Object.hasOwn(raw,match[1]))
    throw Error('Invalid or duplicate live retention profile option');
  raw[match[1]]=Number(match[2]);
}
const options=liveRetentionOptions(raw);
const tls=process.env.NUBLOX_LIVE_MYSQL_TLS==='1';
if(process.env.NUBLOX_LIVE_MYSQL!=='1'&&!tls)
  throw Error('Explicit isolated live MySQL fixture opt-in is required');
if(typeof global.gc!=='function')
  throw Error('Live retention profiling requires Node --expose-gc');

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
  schemaVersion:1,kind:'mysql-live-result-retention-profile',
  status:'running',
  environment:{
    timestamp:new Date().toISOString(),revision:process.env.GITHUB_SHA??null,
    node:process.version,platform:platform(),arch:arch(),
    transport:tls?'verified-tls':'isolated-local',ci:Boolean(process.env.CI)
  },
  options,result:null,errors:{unexpected:0,codes:[]}
};
try{
  report.result=await profileLiveRetention({
    connect:connectDatabase,target,options
  });
  report.status='passed';
}catch(error){
  report.status='failed';
  report.errors.unexpected=1;
  report.errors.codes=[safeError(error)];
  process.exitCode=1;
}finally{
  const dir=resolve('artifacts/qualification');
  mkdirSync(dir,{recursive:true});
  const runId=String(process.env.GITHUB_RUN_ID??'local')
    .replace(/[^0-9A-Za-z-]/g,'');
  const path=resolve(dir,'mysql-live-retention-'+
    (tls?'tls':'local')+'-'+runId+'-'+Date.now()+'.json');
  writeFileSync(path,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({report:path,status:report.status,
    environment:report.environment,options:report.options,
    result:report.result,errors:report.errors},null,2));
}
