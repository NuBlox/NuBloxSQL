#!/usr/bin/env node
/**
 * Multiple real mysqld crashes, bounded pool-queue pressure and cleanup.
 * CI-only: the underlying restart runner validates the image and explicit
 * destructive-fixture permission before each Docker operation.
 *
 * All SQL is parameterised and read-only. Evidence never stores credentials,
 * SQL, result rows, server connection IDs or untrusted error messages.
 */
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {copyFileSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {platform,arch} from 'node:os';
import {performance} from 'node:perf_hooks';
import {createDatabasePool} from '../../packages/driver/dist/index.js';
import {parseOutageOptions,validateOutageEvidence} from './outage-evidence.mjs';

const exec=promisify(execFile);
const config=parseOutageOptions(process.argv.slice(2));
const version=process.env.NUBLOX_QUALIFICATION_MYSQL_VERSION;
const container=process.env.NUBLOX_QUALIFICATION_CONTAINER;
const revision=process.env.GITHUB_SHA;
if(process.env.CI!=='true'||process.env.NUBLOX_LIVE_MYSQL!=='1'||
   process.env.NUBLOX_ALLOW_DESTRUCTIVE_MYSQL_FIXTURE!=='1'||
   !/^\d+\.\d+\.\d+$/.test(version??'')||
   !/^[a-f0-9]{12,64}$/.test(container??'')||
   !/^[a-f0-9]{40}$/.test(revision??''))
  throw Error('An explicitly allowed, pinned, throwaway CI MySQL fixture is required');

const target={engine:'mysql',host:'127.0.0.1',
  port:Number(process.env.MYSQL_PORT??3306),
  user:process.env.MYSQL_USER??'root',
  password:process.env.MYSQL_PASSWORD??'test-password',
  database:process.env.MYSQL_DATABASE??'nublox_test',
  security:'isolated-local',timeoutMs:15000};
assert.ok(Number.isSafeInteger(target.port)&&target.port>0&&target.port<=65535);
const elapsed=()=>Math.round(performance.now());
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
const until=async(check,ms,label)=>{
  const start=performance.now();
  while(!check()){
    if(performance.now()-start>=ms)throw Error('Resilience stage deadline: '+label);
    await sleep(10);
  }
};
const exactVersion=actual=>actual===version||actual.startsWith(version+'-');
const safeError=error=>/^[A-Z_]{2,40}$/.test(error?.code??'')?
  error.code:'QUALIFICATION_FAILED';
const dir=resolve('artifacts/qualification');
const runId=String(process.env.GITHUB_RUN_ID??'local').replace(/[^a-z0-9-]/gi,'');
const childFile=resolve(dir,'mysql-restart-'+version+'-'+runId+'.json');
const report={schemaVersion:1,kind:'mysql-repeated-outages',status:'running',
  revision,environment:{node:process.version,platform:platform(),arch:arch(),
    ci:true,image:'mysql:'+version,serverVersion:null,transport:'isolated-local'},
  configuration:config,cycles:[],resources:{},failureCode:null};

async function poolPressure(label){
  const pool=createDatabasePool(target,{maxConnections:config.poolSize,
    acquireTimeoutMs:15000,healthCheckTimeoutMs:2000,idleTimeoutMs:60000});
  let entered=0,release;
  const gate=new Promise(done=>{release=done;});
  const start=performance.now();
  let peakSize=0,peakPending=0;
  const sample=()=>{
    const stats=pool.stats;
    peakSize=Math.max(peakSize,stats.size);
    peakPending=Math.max(peakPending,stats.pending);
    assert.ok(stats.size<=config.poolSize,'Pool exceeded physical connection cap');
  };
  const observer=setInterval(sample,5);
  observer.unref();
  try{
    const jobs=Array.from({length:config.borrowers},(_,i)=>
      pool.withConnection(async lease=>{
        assert.ok(exactVersion(lease.info.version),'Unexpected server during '+label);
        report.environment.serverVersion=lease.info.version;
        const result=await lease.query('SELECT ? AS pressure_value',[i]);
        assert.equal(result.rows[0].pressure_value,BigInt(i));
        if(++entered<=config.poolSize)await gate;
      }));
    // Promise.allSettled attaches rejection handlers while workers wait for
    // the deterministic two-connection gate. No application query is replayed.
    const results=Promise.allSettled(jobs);
    await until(()=>entered>=config.poolSize&&pool.stats.pending>=1,
      15000,'pending pressure on '+label);
    sample();
    release();
    const outcomes=await results;
    assert.ok(outcomes.every(item=>item.status==='fulfilled'),
      'Every queued borrower must complete exactly once');
    sample();
    assert.equal(pool.stats.pending,0);
    return {completed:outcomes.length,peakPending,peakSize,
      sizeAfterClose:null,pendingAfterClose:null,
      elapsedMs:Math.round((performance.now()-start)*1000)/1000};
  }finally{
    release?.();
    clearInterval(observer);
    await pool.close();
    assert.equal(pool.stats.size,0,'Pool shutdown leaked native slots');
    assert.equal(pool.stats.pending,0,'Pool shutdown leaked waiters');
  }
}

// Snapshot the post-close state only after the pool's native disposal barrier.
async function checkedPressure(label){
  // A small wrapper records a single phase only after all disposals settle.
  const pressure=await poolPressure(label);
  pressure.sizeAfterClose=0;
  pressure.pendingAfterClose=0;
  return pressure;
}

const started=performance.now();
try{
  for(let i=0;i<config.cycles;i++){
    const round={number:i+1,status:'running'};
    round.pressureBefore=await checkedPressure('before-'+(i+1));
    // The existing restart runner performs an actual SIGKILL and restart
    // after sending an in-flight prepared SQL request, then proves no replay
    // and an independently authenticated replacement connection.
    await exec(process.execPath,['tools/qualification/mysql-restart-recovery.mjs'],
      {timeout:180000,maxBuffer:256*1024,env:process.env});
    const child=JSON.parse(readFileSync(childFile,'utf8'));
    assert.equal(child.status,'passed','Underlying restart qualification failed');
    assert.equal(child.revision,revision);
    assert.equal(child.environment.image,'mysql:'+version);
    assert.ok(exactVersion(child.environment.serverVersion));
    round.recovery={status:child.status,revision:child.revision,
      serverVersion:version,
      ...child.recovery,poolClosed:child.resources.poolClosed?.size};
    // Each original single-restart report is retained independently. The
    // underlying runner reuses one fixed filename, so copy it before the
    // next destructive cycle.
    copyFileSync(childFile,resolve(dir,
      'mysql-outage-cycle-'+version+'-'+runId+'-'+(i+1)+'.json'));
    round.pressureAfter=await checkedPressure('after-'+(i+1));
    const memory=process.memoryUsage();
    round.rssAfterBytes=memory.rss;
    round.heapAfterBytes=memory.heapUsed;
    round.status='passed';
    report.cycles.push(round);
  }
  report.status='passed';
  validateOutageEvidence(report,{version,revision,minimumCycles:config.cycles});
}catch(error){
  report.status='failed';
  report.failureCode=safeError(error);
  process.exitCode=1;
}finally{
  report.resources.elapsedMs=Math.round((performance.now()-started)*1000)/1000;
  report.resources.finalRssBytes=process.memoryUsage().rss;
  report.resources.finalHeapBytes=process.memoryUsage().heapUsed;
  mkdirSync(dir,{recursive:true});
  const file=resolve(dir,'mysql-repeated-outages-'+version+'-'+runId+'.json');
  writeFileSync(file,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({status:report.status,cyclesCompleted:report.cycles.length,
    requestedCycles:config.cycles,version,failureCode:report.failureCode,
    evidence:file}));
}
