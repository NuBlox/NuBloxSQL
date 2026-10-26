#!/usr/bin/env node
/**
 * Opt-in side-by-side qualification; mysql2 is installed into the isolated
 * tools/qualification/mysql2-isolated directory, NEVER the driver package.
 * Reports exclude SQL, connection targets, credential values and exceptions.
 */
import {performance} from 'node:perf_hooks';
import {createRequire} from 'node:module';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {cpus,platform,arch} from 'node:os';
import {connectDatabase} from '../../packages/driver/dist/index.js';
import {compareClients,parseComparisonArgs} from './comparison.mjs';
import {safeError} from './metrics.mjs';

const configuration=parseComparisonArgs(process.argv.slice(2));
if(process.env.NUBLOX_LIVE_MYSQL!=='1'||
  process.env.NUBLOX_LIVE_MYSQL_TLS==='1')
  throw Error('Comparison requires explicit, isolated local MySQL fixture');
const requireComparator=createRequire(new URL('./mysql2-isolated/entry.cjs',import.meta.url));
let mysql2,competitorVersion;
try{
  mysql2=requireComparator('mysql2/promise');
  competitorVersion=requireComparator('mysql2/package.json').version;
}catch{
  throw Error('Install pinned mysql2 in tools/qualification/mysql2-isolated; see qualification README');
}
if(competitorVersion!=='3.24.6')
  throw Error('Comparison requires the pinned mysql2 3.24.6 version');

const target={
  engine:'mysql',host:'127.0.0.1',
  port:Number(process.env.MYSQL_PORT??3306),
  user:process.env.MYSQL_USER??'root',
  password:process.env.MYSQL_PASSWORD??'test-password',
  database:process.env.MYSQL_DATABASE??'nublox_test',
  security:'isolated-local',timeoutMs:15000
};
const mysql2Options={
  host:target.host,port:target.port,user:target.user,
  password:target.password,database:target.database,
  connectTimeout:target.timeoutMs,
  multipleStatements:false
};
const ownVersion=JSON.parse(readFileSync(
  new URL('../../packages/driver/package.json',import.meta.url),'utf8'
)).version;

const adapters=[
  {
    name:'nubloxsql',version:ownVersion,
    async open(){
      const db=await connectDatabase(target);
      return {
        async version(){return db.info.version;},
        async prepare(sql){
          const statement=await db.prepare(sql);
          return {
            async execute(n){return (await statement.execute([n])).rows[0].benchmark_value;},
            async close(){await statement.close();}
          };
        },
        async close(){await db.close();}
      };
    }
  },{
    name:'mysql2',version:competitorVersion,
    async open(){
      const db=await mysql2.createConnection(mysql2Options);
      return {
        async version(){const [rows]=await db.query('SELECT VERSION() AS version');return rows[0].version;},
        async prepare(sql){
          const statement=await db.prepare(sql);
          return {
            async execute(n){const [rows]=await statement.execute([n]);return rows[0].benchmark_value;},
            async close(){await statement.close();}
          };
        },
        async close(){await db.end();}
      };
    }
  }
];

const started=performance.now();
const report={
  schemaVersion:1,kind:'mysql-client-comparison',status:'running',
  environment:{
    timestamp:new Date().toISOString(),node:process.version,
    platform:platform(),arch:arch(),cpuCount:cpus().length,
    ci:Boolean(process.env.CI),revision:process.env.GITHUB_SHA??null,
    transport:'isolated-local',serverVersion:null
  },
  configuration,clients:{nubloxsql:ownVersion,mysql2:competitorVersion},
  workloads:null,errors:{unexpected:0,codes:[]}
};
try{
  const result=await compareClients(adapters,configuration);
  report.environment.serverVersion=result.serverVersion;
  report.workloads={method:result.method,results:result.results};
  report.status='passed';
}catch(error){
  report.status='failed';
  report.errors.unexpected=1;
  report.errors.codes=[safeError(error)];
  process.exitCode=1;
}finally{
  report.environment.totalElapsedMs=Math.round((performance.now()-started)*1000)/1000;
  const directory=resolve('artifacts/qualification');
  mkdirSync(directory,{recursive:true});
  const runId=String(process.env.GITHUB_RUN_ID??'local').replace(/[^A-Za-z0-9-]/g,'');
  const filename=resolve(directory,`comparison-local-${runId}-${Date.now()}.json`);
  writeFileSync(filename,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({report:filename,status:report.status,
    clients:report.clients,workloads:report.workloads,errors:report.errors},null,2));
}
