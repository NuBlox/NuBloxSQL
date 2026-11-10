#!/usr/bin/env node
/** Pinned disposable CI verified-TLS cache endurance; never run on customer DBs.
 * Records only numeric telemetry, scoped flags and redacted error codes. */
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {arch,platform,cpus} from 'node:os';
import {connectDatabase} from '../../packages/driver/dist/index.js';
import {CACHE_HOT_SQL,CACHE_CHURN_SQL} from './cache-concurrency.mjs';
import {cacheFixtureProfile,verifyCacheTlsFixture} from './cache-fixture.mjs';
import {cacheEnduranceOptions,runCacheEndurance} from './cache-endurance.mjs';
import {safeError} from './metrics.mjs';

const env=process.env;
const options=cacheEnduranceOptions(process.argv.slice(2),env);
const profile=cacheFixtureProfile(env,{
  concurrency:8,
  ca:readFileSync(env.NUBLOX_TLS_CA_FILE,'utf8'),
  unrelatedCa:readFileSync(env.NUBLOX_TLS_OTHER_CA_FILE,'utf8')
});
if(profile.transport!=='verified-tls'||profile.version!=='8.4.13'||
   profile.limit!==8)
  throw Error('Cache endurance requires pinned TLS-only MySQL fixture');

const report={
  schemaVersion:1,kind:'mysql-verified-tls-cache-endurance',
  status:'running',
  environment:{
    revision:env.GITHUB_SHA,runId:env.GITHUB_RUN_ID,event:env.GITHUB_EVENT_NAME,
    node:process.version,platform:platform(),arch:arch(),cpuCount:cpus().length,
    mysqlVersion:null,transport:profile.transport,maxPreparedStatements:null,
    tlsChecks:null,ci:true
  },
  options,workload:null,windows:[],progress:{phase:'preflight'},
  errors:{codes:[]},
  caveat:'Memory is process-wide and p95/p99 are bounded reservoir approximations, not driver-leak attribution or production guarantees.'
};
let observer;
try{
  observer=await connectDatabase({...profile.target,statementCacheSize:0});
  report.environment.mysqlVersion=observer.info.version;
  if(!/^8\.4\.13(?:[-+].*)?$/.test(observer.info.version))
    throw Error('Unexpected pinned MySQL version');
  report.environment.tlsChecks=await verifyCacheTlsFixture({
    connect:connectDatabase,observer,profile
  });
  const limit=(await observer.queryText(
    'SELECT @@global.max_prepared_stmt_count AS quota')).rows[0]?.quota;
  report.environment.maxPreparedStatements=Number(limit);
  if(Number(limit)!==8)throw Error('Unexpected global prepared-statement quota');

  const census="SELECT COUNT(*) AS n FROM "+
    "performance_schema.prepared_statements_instances WHERE SQL_TEXT IN ('"+
    CACHE_HOT_SQL+"','"+CACHE_CHURN_SQL+"')";
  const inspect=async()=>{
    const result=await observer.queryText(census);
    const n=Number(result.rows[0]?.n);
    if(!Number.isSafeInteger(n)||n<0)
      throw Error('Invalid server-side prepared-handle census');
    return n;
  };
  report.workload=await runCacheEndurance({
    connect:connectDatabase,target:profile.target,inspect,options,
    onStage:phase=>{report.progress={phase};},
    onWindow:window=>{report.windows.push(window);}
  });
  report.progress={phase:'completed'};
  report.status='passed';
}catch(error){
  report.status='failed';
  report.errors.codes.push(safeError(error));
  process.exitCode=1;
}finally{
  if(observer)try{await observer.close();}
  catch{
    report.status='failed';
    report.errors.codes.push('OBSERVER_CLEANUP_ERROR');
    process.exitCode=1;
  }
  const path=resolve('artifacts/qualification');
  mkdirSync(path,{recursive:true});
  const file=resolve(path,'mysql-cache-endurance-tls-'+env.GITHUB_RUN_ID+'.json');
  writeFileSync(file,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({
    kind:report.kind,status:report.status,report:file,
    elapsedMs:report.workload?.elapsedMs??0,
    completed:report.workload?.completed??0,
    windows:report.windows.length,
    errors:report.errors
  }));
}
