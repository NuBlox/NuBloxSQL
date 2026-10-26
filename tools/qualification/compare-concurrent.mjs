#!/usr/bin/env node
/**
 * Comparative concurrent prepared-statement qualification (experimental).
 * Reuses the independently installed peer supplied by the existing #389
 * comparison. No mysql2 runtime dependency is added to @nublox/driver.
 */
import {createRequire} from 'node:module';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {platform,arch,cpus} from 'node:os';
import {connectDatabase} from '../../packages/driver/dist/index.js';
import {runComparison} from './comparison/core.mjs';
import {analyseComparison} from './comparison/analyse.mjs';
import {integerOption,safeError} from './metrics.mjs';

if(process.env.NUBLOX_LIVE_MYSQL!=='1'||process.env.NUBLOX_LIVE_MYSQL_TLS==='1')
  throw Error('Concurrent comparison needs explicit isolated loopback MySQL');
const opts={};
for(const arg of process.argv.slice(2)){
  const match=/^--(iterations|concurrency|rounds)=([0-9]+)$/.exec(arg);
  if(!match||Object.hasOwn(opts,match[1]))
    throw Error('Unknown or duplicate comparison option');
  opts[match[1]]=Number(match[2]);
}
const iterations=integerOption(opts.iterations??48,{name:'iterations',min:4,max:2000});
const concurrency=integerOption(opts.concurrency??4,{name:'concurrency',min:1,max:8});
const rounds=integerOption(opts.rounds??4,{name:'rounds',min:2,max:8});
const port=integerOption(process.env.MYSQL_PORT??3306,{name:'port',min:1,max:65535});
const target={
  engine:'mysql',host:'127.0.0.1',port,
  user:process.env.MYSQL_USER??'root',
  password:process.env.MYSQL_PASSWORD??'test-password',
  database:process.env.MYSQL_DATABASE??'nublox_test',
  security:'isolated-local',timeoutMs:30000
};
const peerRequire=createRequire(new URL('./mysql2-isolated/entry.cjs',import.meta.url));
let mysql2,peerVersion;
try{
  mysql2=peerRequire('mysql2/promise');
  peerVersion=peerRequire('mysql2/package.json').version;
}catch{
  throw Error('Install the pinned isolated mysql2 comparison peer first');
}
if(peerVersion!=='3.24.6')throw Error('Unexpected mysql2 peer version');

const native={
  async open(){
    const db=await connectDatabase(target);
    return {
      close:()=>db.close(),
      async prepare(sql){
        const statement=await db.prepare(sql);
        return {
          execute:async args=>(await statement.execute(args)).rows[0].value,
          close:()=>statement.close()
        };
      }
    };
  }
};
const competitor={
  async open(){
    const db=await mysql2.createConnection({
      host:target.host,port,user:target.user,password:target.password,
      database:target.database,connectTimeout:30000,
      multipleStatements:false,ssl:false
    });
    return {
      close:()=>db.end(),
      async prepare(sql){
        const statement=await db.prepare(sql);
        return {
          execute:async args=>{
            const [rows]=await statement.execute(args);
            return rows[0].value;
          },
          close:()=>statement.close()
        };
      }
    };
  }
};

const report={
  schemaVersion:1,kind:'mysql-concurrent-prepared-comparison',status:'running',
  environment:{
    timestamp:new Date().toISOString(),revision:process.env.GITHUB_SHA??null,
    node:process.version,platform:platform(),arch:arch(),cpuCount:cpus().length,
    ci:Boolean(process.env.CI),transport:'isolated-local',
    serverVersion:null,peerVersion
  },
  configuration:{
    iterations,concurrency,rounds,
    preparedWarmupPerSession:8,
    ordering:'alternating by round',
    workloads:['connectionOnly','preparedSequential','preparedConcurrent']
  },
  trials:[],analysis:null,errors:{codes:[]}
};
let reference;
try{
  reference=await connectDatabase(target);
  report.environment.serverVersion=reference.info.version;
  await reference.close();
  reference=undefined;
  report.trials=await runComparison({
    adapters:{nubloxsql:native,mysql2:competitor},iterations,concurrency,rounds
  });
  report.analysis=analyseComparison(report.trials,{rounds,iterations});
  report.status='passed';
}catch(error){
  report.status='failed';
  report.errors.codes.push(safeError(error));
  process.exitCode=1;
}finally{
  await reference?.close().catch(()=>{});
  const folder=resolve('artifacts/qualification');
  mkdirSync(folder,{recursive:true});
  const runId=String(process.env.GITHUB_RUN_ID??'local').replace(/[^A-Za-z0-9-]/g,'');
  const reportPath=resolve(folder,`comparison-concurrent-${runId}-${Date.now()}.json`);
  writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({
    report:reportPath,status:report.status,
    environment:report.environment,configuration:report.configuration,
    trials:report.trials,analysis:report.analysis,errors:report.errors
  },null,2));
}
