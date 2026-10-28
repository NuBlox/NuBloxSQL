#!/usr/bin/env node
/**
 * CI-only destructive recovery qualification against an isolated MySQL
 * Docker service. Never run against an application or production container.
 * Reports omit credentials, SQL text, rows and server connection identifiers.
 */
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {arch,platform} from 'node:os';
import {performance} from 'node:perf_hooks';
import {connectDatabase,createDatabasePool} from '../../packages/driver/dist/index.js';

const runFile=promisify(execFile);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const version=process.env.NUBLOX_QUALIFICATION_MYSQL_VERSION;
const container=process.env.NUBLOX_QUALIFICATION_CONTAINER;
const allowed=process.env.CI==='true'&&
  process.env.NUBLOX_LIVE_MYSQL==='1'&&
  process.env.NUBLOX_ALLOW_DESTRUCTIVE_MYSQL_FIXTURE==='1'&&
  /^\d+\.\d+\.\d+$/.test(version??'')&&
  /^[a-f0-9]{12,64}$/.test(container??'');
if(!allowed)throw Error('A dedicated, explicitly enabled CI MySQL fixture is required');

const docker=async(args,timeout=30000)=>{
  const {stdout}=await runFile('docker',args,{timeout,maxBuffer:128*1024});
  return stdout.trim();
};
const until=async(predicate,timeoutMs,message)=>{
  const deadline=performance.now()+timeoutMs;
  do{
    if(await predicate())return;
    await sleep(250);
  }while(performance.now()<deadline);
  throw Error(message);
};
const target={
  engine:'mysql',host:'127.0.0.1',
  port:Number(process.env.MYSQL_PORT??3306),
  user:process.env.MYSQL_USER??'root',
  password:process.env.MYSQL_PASSWORD??'test-password',
  database:process.env.MYSQL_DATABASE??'nublox_test',
  security:'isolated-local',timeoutMs:30000
};
if(!Number.isSafeInteger(target.port)||target.port<1||target.port>65535)
  throw Error('Invalid loopback fixture port');

const report={
  schemaVersion:1,kind:'mysql-restart-recovery',status:'running',
  revision:process.env.GITHUB_SHA??null,
  environment:{node:process.version,platform:platform(),arch:arch(),
    image:'mysql:'+version,serverVersion:null,transport:'isolated-local'},
  recovery:{inFlightExecutions:0,expectedInterrupted:false,preparedRevoked:false,
    oldSessionRetired:false,poolReconnected:false,exactlyOnce:true},
  resources:{poolBefore:null,poolAfter:null},
  failureCode:null
};
let db,stmt,pool,killed=false,restarted=false;
const startedAt=performance.now();
try{
  // Even the explicit opt-in cannot restart an unexpected container.
  assert.equal(await docker(['inspect','--format','{{.Config.Image}}',container]),
    'mysql:'+version,'Destructive fixture image identity mismatch');
  assert.equal(await docker(['inspect','--format','{{.State.Health.Status}}',container]),
    'healthy','Fixture must already be healthy');
  db=await connectDatabase(target);
  report.environment.serverVersion=db.info.version;
  assert.ok(db.info.version.startsWith(version.slice(0,version.lastIndexOf('.')+1)),
    'Connected MySQL major.minor version mismatch');

  stmt=await db.prepare('SELECT ? AS statement_owned_before_restart');
  assert.equal((await stmt.execute([201])).rows[0].statement_owned_before_restart,201n);

  pool=createDatabasePool(target,{maxConnections:1,acquireTimeoutMs:12000,
    healthCheckTimeoutMs:2000});
  const oldPoolId=await pool.withConnection(async lease=>
    (await lease.query('SELECT CONNECTION_ID() AS id')).rows[0].id);
  report.resources.poolBefore=pool.stats;
  assert.equal(pool.stats.idle,1);

  // Arm a long-running real server operation and kill mysqld only after
  // its COM_STMT_EXECUTE has reached the native transport exactly once.
  const nativeSend=db.send.bind(db);
  let resolveSent;
  const sent=new Promise(resolve=>{resolveSent=resolve;});
  db.send=async frame=>{
    await nativeSend(frame);
    if(frame[0]===0x17){
      report.recovery.inFlightExecutions++;
      resolveSent();
    }
  };
  const active=db.query('SELECT SLEEP(?) AS interrupted',[15]);
  void active.catch(()=>{});
  await Promise.race([sent,sleep(8000).then(()=>{throw Error('Long query never reached transport');})]);
  assert.equal(report.recovery.inFlightExecutions,1);

  await docker(['kill','--signal=KILL',container],12000);
  killed=true;
  const outcome=await Promise.race([
    active.then(()=>({ok:true}),error=>({ok:false,code:error?.code})),
    sleep(12000).then(()=>({ok:true,timedOut:true}))
  ]);
  assert.equal(outcome.ok,false,'Server kill must interrupt the in-flight query');
  assert.equal(outcome.code,'CONNECTION_CLOSED');
  report.recovery.expectedInterrupted=true;
  await until(()=>db.closed,5000,'Killed native transport was not invalidated');
  report.recovery.oldSessionRetired=db.closed;
  assert.equal(stmt.closed,true,'Transport failure must revoke prepared handles');
  report.recovery.preparedRevoked=true;
  await assert.rejects(stmt.execute([202]),e=>e.code==='CONNECTION_CLOSED');
  await assert.rejects(db.query('SELECT 1'),e=>e.code==='CONNECTION_CLOSED');

  await docker(['start',container],30000);
  restarted=true;
  await until(async()=>{
    try{return await docker(['inspect','--format','{{.State.Health.Status}}',container],5000)==='healthy';}
    catch{return false;}
  },90000,'MySQL service did not recover after restart');

  const recoveredId=await pool.withConnection(async lease=>{
    assert.equal((await lease.query('SELECT ? AS recovered',[203])).rows[0].recovered,203n);
    return (await lease.query('SELECT CONNECTION_ID() AS id')).rows[0].id;
  });
  assert.notEqual(recoveredId,oldPoolId,'Pool cannot reuse a pre-restart session');
  assert.ok(pool.stats.created>=2);
  assert.equal(pool.stats.pending,0);
  assert.ok(pool.stats.size<=1);
  report.recovery.poolReconnected=true;
  report.resources.poolAfter=pool.stats;
  assert.equal(report.recovery.inFlightExecutions,1,'No application SQL replay');
  report.status='passed';
}catch(error){
  report.status='failed';
  report.failureCode=typeof error?.code==='string'?error.code:'QUALIFICATION_FAILED';
  process.exitCode=1;
}finally{
  if(killed&&!restarted){
    try{await docker(['start',container],30000);}catch{}
  }
  const settled=await Promise.allSettled([
    Promise.resolve().then(()=>stmt?.close()),
    Promise.resolve().then(()=>db?.close()),
    Promise.resolve().then(()=>pool?.close())
  ]);
  if(settled.some(x=>x.status==='rejected')){
    report.status='failed';
    report.failureCode??='CLEANUP_FAILED';
    process.exitCode=1;
  }
  if(pool&&pool.stats.size!==0){
    report.status='failed';
    report.failureCode??='CAPACITY_LEAK';
    process.exitCode=1;
  }
  report.resources.poolClosed=pool?.stats??null;
  report.resources.elapsedMs=Math.round((performance.now()-startedAt)*1000)/1000;
  const directory=resolve('artifacts/qualification');
  mkdirSync(directory,{recursive:true});
  const safeRunId=String(process.env.GITHUB_RUN_ID??'local').replace(/[^a-z0-9-]/gi,'');
  const filename=resolve(directory,'mysql-restart-'+version+'-'+safeRunId+'.json');
  writeFileSync(filename,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({report:filename,status:report.status,
    recovery:report.recovery,failureCode:report.failureCode},null,2));
}
