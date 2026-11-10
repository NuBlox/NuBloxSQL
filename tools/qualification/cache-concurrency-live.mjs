#!/usr/bin/env node
/** Disposable-CI-only native MySQL cache concurrency and global-quota profile.
 * This script never changes server configuration or executes writes. The
 * workflow owns a temporary MySQL server and enforces the four-handle quota. */
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {platform,arch,cpus} from 'node:os';
import {connectDatabase} from '../../packages/driver/dist/index.js';
import {CACHE_HOT_SQL,CACHE_CHURN_SQL,cacheProfileOptions,runCacheMatrix}
  from './cache-concurrency.mjs';
import {safeError} from './metrics.mjs';
import {cacheFixtureProfile,verifyCacheTlsFixture} from './cache-fixture.mjs';

const options=cacheProfileOptions(process.argv.slice(2));
const tls=process.env.NUBLOX_LIVE_MYSQL_TLS==='1';
const profile=cacheFixtureProfile(process.env,{
  concurrency:options.concurrency,
  ...(tls?{
    ca:readFileSync(process.env.NUBLOX_TLS_CA_FILE,'utf8'),
    unrelatedCa:readFileSync(process.env.NUBLOX_TLS_OTHER_CA_FILE,'utf8')
  }:{})
});
const report={
  schemaVersion:1,kind:'mysql-native-cache-concurrency',
  status:'running',
  environment:{
    node:process.version,platform:platform(),arch:arch(),cpuCount:cpus().length,
    revision:process.env.GITHUB_SHA??null,
    runId:process.env.GITHUB_RUN_ID??null,
    transport:profile.transport,mysqlVersion:null,maxPreparedStatements:null,
    tlsSecurityChecks:null
  },
  configuration:{
    ...options,configuredServerLimit:profile.limit,preparedCacheCapacity:1,
    warmupsPerConnection:4,
    modes:['uncached','cached','churn'],
    hotComparisonOrder:'alternating between rounds',
    churnPurpose:'global-quota enforcement and eviction correctness'
  },
  observations:[],
  errors:{codes:[]},
  caveat:'Disposable loopback MySQL only; timings include real SQL/network and session scheduling. Results are diagnostic, not commercial latency claims.'
};
let observer;
try{
  observer=await connectDatabase({...profile.target,statementCacheSize:0});
  report.environment.mysqlVersion=observer.info.version;
  if(observer.info.version!==profile.version&&
     !observer.info.version.startsWith(profile.version+'-')&&
     !observer.info.version.startsWith(profile.version+'+'))
    throw Error('Unexpected pinned MySQL version');
  if(tls)
    report.environment.tlsSecurityChecks=await verifyCacheTlsFixture({
      connect:connectDatabase,observer,profile
    });
  const limit=await observer.queryText(
    'SELECT @@GLOBAL.max_prepared_stmt_count AS limit_value');
  const observedLimit=Number(limit.rows[0]?.limit_value);
  report.environment.maxPreparedStatements=observedLimit;
  if(observedLimit!==profile.limit)
    throw Error('Disposable server global prepared statement quota differs from fixture');

  // QueryText emits no COM_STMT_PREPARE; census reads cannot use any of the
  // configured server prepared statement slots. Both SQL strings are constants.
  const census="SELECT COUNT(*) AS n FROM "+
    "performance_schema.prepared_statements_instances WHERE SQL_TEXT IN ('"+
    CACHE_HOT_SQL+"','"+CACHE_CHURN_SQL+"')";
  const inspect=async()=>{
    const result=await observer.queryText(census);
    const value=Number(result.rows[0]?.n);
    if(!Number.isSafeInteger(value)||value<0)
      throw Error('Invalid Performance Schema statement census');
    return value;
  };
  report.observations=await runCacheMatrix({
    open:mode=>connectDatabase({
      ...profile.target,statementCacheSize:mode==='uncached'?0:1
    }),
    inspect,...options
  });
  report.status='passed';
}catch(error){
  report.status='failed';
  report.errors.codes.push(safeError(error));
  process.exitCode=1;
}finally{
  if(observer){
    try{await observer.close();}
    catch{
      report.status='failed';
      report.errors.codes.push('OBSERVER_CLEANUP_ERROR');
      process.exitCode=1;
    }
  }
  mkdirSync(resolve('artifacts/qualification'),{recursive:true});
  const id=String(process.env.GITHUB_RUN_ID??'local')
    .replace(/[^0-9A-Za-z-]/g,'');
  const filename=resolve('artifacts/qualification',
    'mysql-cache-concurrency-'+(tls?'tls-':'')+id+'.json');
  writeFileSync(filename,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({report:filename,...report},null,2));
}
