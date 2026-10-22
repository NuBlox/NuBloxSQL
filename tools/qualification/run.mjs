#!/usr/bin/env node
/**
 * Reproducible qualification runner. Read-only SQL only.
 * No SQL, credentials, certificate material, error messages or row data in reports.
 */
import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {cpus,platform,arch} from 'node:os';
import {connectDatabase,createDatabasePool} from '../../packages/driver/dist/index.js';
import {parseArgs,summarize,safeError} from './metrics.mjs';

const mode=process.argv[2];
const config=parseArgs(process.argv.slice(3),mode);
const tls=process.env.NUBLOX_LIVE_MYSQL_TLS==='1';
if((tls?process.env.NUBLOX_LIVE_MYSQL_TLS:process.env.NUBLOX_LIVE_MYSQL)!=='1')
  throw Error('Real MySQL fixture must be explicitly enabled for qualification');
const base={
  engine:'mysql',host:'127.0.0.1',
  port:Number(process.env[tls?'MYSQL_TLS_PORT':'MYSQL_PORT']??(tls?3307:3306)),
  user:process.env.MYSQL_USER??'root',
  password:process.env.MYSQL_PASSWORD??'test-password',
  database:process.env.MYSQL_DATABASE??'nublox_test',
  security:tls?'verified-tls':'isolated-local',
  timeoutMs:30000
};
if(tls){
  base.ca=readFileSync(process.env.NUBLOX_TLS_CA_FILE,'utf8');
  base.serverName='localhost';
}
const check=(yes)=>{if(!yes)throw Error('Qualification assertion failed');};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const latency=async(work,samples)=>{
  const start=performance.now();
  const value=await work();
  samples.push(performance.now()-start);
  return value;
};
const cursorSql=`SELECT a.n+10*b.n+100*c.n AS n
FROM (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL
      SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL
      SELECT 8 UNION ALL SELECT 9) a
JOIN (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL
      SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL
      SELECT 8 UNION ALL SELECT 9) b
JOIN (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL
      SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL
      SELECT 8 UNION ALL SELECT 9) c
WHERE a.n+10*b.n+100*c.n < ? ORDER BY n`;

const report={
  schemaVersion:1,kind:mode,status:'running',
  environment:{
    timestamp:new Date().toISOString(),
    node:process.version,platform:platform(),arch:arch(),cpuCount:cpus().length,
    ci:Boolean(process.env.CI),revision:process.env.GITHUB_SHA??null,
    serverVersion:null,transport:tls?'verified-tls':'isolated-local'
  },
  configuration:config,workloads:{},resources:{},errors:{unexpected:0,expectedSqlErrors:0,codes:[]}
};
let heapPeak=process.memoryUsage().heapUsed;
let rssPeak=process.memoryUsage().rss;
const monitor=monitorEventLoopDelay({resolution:20});
const observer=setInterval(()=>{
  const m=process.memoryUsage();
  heapPeak=Math.max(heapPeak,m.heapUsed);
  rssPeak=Math.max(rssPeak,m.rss);
},50);
observer.unref();
monitor.enable();
const created=[];
let pool;
function target(){return {...base};}
async function opened(){
  const session=await connectDatabase(target());
  created.push(session);
  return session;
}
async function singleSession(){
  const db=await opened();
  report.environment.serverVersion=db.info.version;
  // Warmup is excluded from latency samples.
  const statement=await db.prepare('SELECT ? AS sequence');
  try{
    for(let i=0;i<8;i++)
      check((await statement.execute([i])).rows[0].sequence===BigInt(i));
    const samples=[];
    const start=performance.now();
    for(let i=0;i<config.iterations;i++){
      await latency(async()=>{
        const r=await statement.execute([i]);
        check(r.rows[0].sequence===BigInt(i));
      },samples);
    }
    report.workloads.prepared=summarize(samples,performance.now()-start);
  }finally{
    await statement.close();
    await db.close();
  }
}
async function poolRun(durationBounded){
  pool=createDatabasePool(target(),{
    maxConnections:config.concurrency,acquireTimeoutMs:12000,
    idleTimeoutMs:60000,healthCheckTimeoutMs:2000
  });
  await pool.withConnection(async db=>{
    report.environment.serverVersion=db.info.version;
    check((await db.query('SELECT ? AS sequence',[1])).rows[0].sequence===1n);
  });
  const samples=[],start=performance.now();
  let next=0,failed=false;
  const failures=[];
  const workers=Array.from({length:config.concurrency},(_,worker)=> (async()=>{
    while(!failed){
      const index=next++;
      if(index>=config.iterations)break;
      if(durationBounded&&performance.now()-start>=config.durationMs)break;
      try{
        await latency(async()=>{
          await pool.withConnection(async db=>{
            if(durationBounded&&index%37===0){
              // This is a deliberately expected database error. It must not
              // invalidate the physical session or replay any application SQL.
              try{
                await db.query('SELECT * FROM nublox_qualification_missing_table');
                throw Error('Unexpected success for known invalid SQL');
              }catch(error){
                if(error?.code!=='DATABASE_ERROR')throw error;
                report.errors.expectedSqlErrors++;
              }
            }
            const result=await db.query('SELECT ? AS sequence',[index]);
            check(result.rows[0].sequence===BigInt(index));
          });
        },samples);
      }catch(error){
        failed=true;
        failures.push(safeError(error));
      }
    }
  })());
  await Promise.all(workers);
  report.workloads.pool={...summarize(samples,performance.now()-start),
    workerCount:config.concurrency,completed:samples.length};
  report.resources.poolBeforeClose=pool.stats;
  if(pool.stats.size>config.concurrency||pool.stats.pending!==0||failures.length){
    report.errors.unexpected+=failures.length||1;
    report.errors.codes.push(...failures);
    throw Error('Pool qualification failed');
  }
  await pool.close();
  check(pool.stats.size===0);
  report.resources.poolAfterClose=pool.stats;
  pool=undefined;
}
async function cursorRun(){
  const db=await opened();
  const samples=[];
  const start=performance.now();
  const count=await latency(()=>db.withCursor(cursorSql,[config.cursorRows],async cursor=>{
    let total=0;
    for await(const {row}of cursor){
      check(Number(row.n)===total);
      total++;
    }
    check(cursor.closed);
    return total;
  },{fetchSize:config.fetchSize,timeoutMs:30000}),samples);
  check(count===config.cursorRows);
  report.workloads.cursor={...summarize(samples,performance.now()-start),
    rows:count,fetchSize:config.fetchSize,rowsPerSecond:Math.round(count*1000/(performance.now()-start))};
  await db.close();
}
async function reconnectRun(){
  const samples=[],start=performance.now();
  for(let i=0;i<Math.min(8,config.concurrency+2);i++){
    await latency(async()=>{
      const db=await opened();
      try{
        check((await db.query('SELECT ? AS ready',[i])).rows[0].ready===BigInt(i));
      }finally{await db.close();}
    },samples);
  }
  report.workloads.reconnect=summarize(samples,performance.now()-start);
}
const started=performance.now();
try{
  if(mode==='benchmark'){
    await singleSession();
    await poolRun(false);
    await cursorRun();
    await reconnectRun();
  }else {
    await poolRun(true);
    // A soak is meaningful only when it actually executes workload cycles.
    check(report.workloads.pool.completed>=config.concurrency);
    await reconnectRun();
  }
  check(report.errors.unexpected===0);
  report.status='passed';
}catch(error){
  report.status='failed';
  report.errors.unexpected++;
  report.errors.codes.push(safeError(error));
  process.exitCode=1;
}finally{
  try{await pool?.close();}catch{report.status='failed';process.exitCode=1;}
  await Promise.allSettled(created.map(db=>db.close()));
  clearInterval(observer);
  monitor.disable();
  const m=process.memoryUsage();
  report.resources.heapPeakBytes=Math.max(heapPeak,m.heapUsed);
  report.resources.rssPeakBytes=Math.max(rssPeak,m.rss);
  report.resources.eventLoopDelayP99Ms=monitor.count?
    Math.round(monitor.percentile(99)/1e3)/1e3:null;
  report.resources.totalElapsedMs=Math.round((performance.now()-started)*1000)/1000;
  const directory=resolve('artifacts/qualification');
  mkdirSync(directory,{recursive:true});
  const safeRunId=String(process.env.GITHUB_RUN_ID??'local').replace(/[^0-9a-z-]/gi,'');
  const file=resolve(directory,`${mode}-${tls?'tls':'local'}-${safeRunId}-${Date.now()}.json`);
  writeFileSync(file,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({report:file,status:report.status,metrics:report.workloads,
    errors:report.errors,resources:report.resources},null,2));
}
