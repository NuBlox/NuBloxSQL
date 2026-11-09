#!/usr/bin/env node
/** Disposable-CI-only native MySQL cache concurrency and global-quota profile.
 * This script never changes server configuration or executes writes. The
 * workflow owns a temporary MySQL server and enforces the four-handle quota. */
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {platform,arch,cpus} from 'node:os';
import {connectDatabase} from '../../packages/driver/dist/index.js';
import {CACHE_HOT_SQL,CACHE_CHURN_SQL,cacheProfileOptions,runCacheMatrix}
  from './cache-concurrency.mjs';
import {integerOption,safeError} from './metrics.mjs';

if(process.env.CI!=='true'||
   process.env.NUBLOX_LIVE_MYSQL!=='1'||
   process.env.NUBLOX_CACHE_BENCH_FIXTURE!=='1')
  throw Error('Cache concurrency profile requires explicit disposable CI MySQL opt-in');

const options=cacheProfileOptions(process.argv.slice(2));
const port=integerOption(process.env.MYSQL_PORT??3306,
  {name:'MYSQL_PORT',min:1,max:65535});
const target={
  engine:'mysql',host:'127.0.0.1',port,
  user:process.env.MYSQL_USER??'root',
  password:process.env.MYSQL_PASSWORD??'test-password',
  database:process.env.MYSQL_DATABASE??'nublox_test',
  security:'isolated-local',timeoutMs:30000
};
const report={
  schemaVersion:1,kind:'mysql-native-cache-concurrency',
  status:'running',
  environment:{
    node:process.version,platform:platform(),arch:arch(),cpuCount:cpus().length,
    revision:process.env.GITHUB_SHA??null,
    runId:process.env.GITHUB_RUN_ID??null,
    transport:'isolated-local',mysqlVersion:null,maxPreparedStatements:null
  },
  configuration:{
    ...options,configuredServerLimit:4,preparedCacheCapacity:1,
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
  observer=await connectDatabase({...target,statementCacheSize:0});
  report.environment.mysqlVersion=observer.info.version;
  const limit=await observer.queryText(
    'SELECT @@GLOBAL.max_prepared_stmt_count AS limit_value');
  const observedLimit=Number(limit.rows[0]?.limit_value);
  report.environment.maxPreparedStatements=observedLimit;
  if(observedLimit!==4)throw Error('Disposable server must enforce exactly four prepared handles');

  // QueryText emits no COM_STMT_PREPARE; census reads cannot use any of the
  // four server prepared statement slots. Both SQL strings are constants.
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
      ...target,statementCacheSize:mode==='uncached'?0:1
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
    'mysql-cache-concurrency-'+id+'.json');
  writeFileSync(filename,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({report:filename,...report},null,2));
}
