#!/usr/bin/env node
/**
 * DESTRUCTIVE CI-ONLY two-independent-MySQL endpoint cutover safety test.
 * NOT HA, replication or promotion qualification. Never target a shared DB.
 * Original SQL, operation token, table name, server UUIDs and credentials
 * are deliberately excluded from the retained report.
 */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {platform,arch} from 'node:os';
import {performance} from 'node:perf_hooks';
import {connectDatabase} from '../../packages/driver/dist/index.js';
import {ConnectionPool} from '../../packages/driver/dist/core/pooling.js';
import {assessTwoNodeCutover,validateTwoNodeCutoverEvidence}
  from './two-node-cutover-evidence.mjs';

const exec=promisify(execFile),start=performance.now(),version='8.4.13';
const revision=process.env.GITHUB_SHA,runId=process.env.GITHUB_RUN_ID;
const primaryId=process.env.NUBLOX_PRIMARY_CONTAINER;
const standbyId=process.env.NUBLOX_STANDBY_CONTAINER;
if(process.env.CI!=='true'||process.env.NUBLOX_LIVE_MYSQL!=='1'||
   process.env.NUBLOX_ALLOW_DESTRUCTIVE_MYSQL_FIXTURE!=='1'||
   process.env.NUBLOX_QUALIFICATION_MYSQL_VERSION!==version||
   !/^[a-f0-9]{40}$/.test(revision??'')||!/^[0-9]+$/.test(runId??'')||
   !/^[a-f0-9]{12,64}$/.test(primaryId??'')||
   !/^[a-f0-9]{12,64}$/.test(standbyId??'')||primaryId===standbyId)
  throw Error('Only two independently pinned disposable CI MySQL nodes are permitted');
const port=x=>Number(x);
const primaryPort=port(process.env.NUBLOX_PRIMARY_PORT??3306);
const standbyPort=port(process.env.NUBLOX_STANDBY_PORT??3307);
assert.ok([primaryPort,standbyPort].every(x=>
  Number.isSafeInteger(x)&&x>=1&&x<=65535)&&primaryPort!==standbyPort);
const target=p=>({engine:'mysql',host:'127.0.0.1',port:p,
  user:process.env.MYSQL_USER??'root',
  password:process.env.MYSQL_PASSWORD??'test-password',
  database:process.env.MYSQL_DATABASE??'nublox_test',
  security:'isolated-local',timeoutMs:15000});
const primary=target(primaryPort),standby=target(standbyPort);
const docker=async(args,timeout=30000)=>
  (await exec('docker',args,{timeout,maxBuffer:128*1024})).stdout.trim();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(predicate,limit,message)=>{
  const deadline=performance.now()+limit;
  while(performance.now()<deadline){
    try{if(await predicate())return;}catch{}
    await sleep(250);
  }
  throw Error(message);
};
async function scopedDb(t,run){
  const db=await connectDatabase(t);
  try{
    assert.equal(db.info.version,version,'Unexpected MySQL version');
    return await run(db);
  }finally{await db.close();}
}
const table='nublox_cutover_'+randomUUID().replaceAll('-','').slice(0,16);
const token=randomUUID();
const report={
  schemaVersion:1,kind:'mysql-two-node-cutover',status:'running',
  failureCode:null,revision,runId,
  environment:{ci:true,node:process.version,platform:platform(),arch:arch(),
    transport:'isolated-local',primaryImage:'mysql:'+version,
    standbyImage:'mysql:'+version,primaryVersion:null,standbyVersion:null,
    distinctServerIdentities:false},
  outcome:{
    primaryCommittedBeforeCrash:false,primaryKilled:false,
    inflightQueryInterrupted:false,oldPoolDiscarded:false,
    standbyReachableAfterCrash:false,standbyCommittedTokenCount:null,
    primaryCommittedTokenCountAfterRestart:null,primaryRestored:false,
    originalWriteExecutions:0,originalWriteReplays:0,
    standbyWriteExecutions:0,promotionAttempts:0,cutoverDecision:null,
    resumeWrites:null
  },
  resources:{primaryPoolCreated:0,primaryPoolDiscarded:0,
    primaryPoolAfterClose:null,pendingAfterClose:null},
  cleanup:{primaryTableDropped:false,standbyTableDropped:false,
    primaryServerHealthy:false},elapsedMs:null
};
let createdPrimary=false,createdStandby=false,crashed=false,restarted=false,pool;
try{
  for(const id of [primaryId,standbyId]){
    assert.equal(await docker(['inspect','--format','{{.Config.Image}}',id]),
      'mysql:'+version,'Unapproved MySQL container identity');
    assert.equal(await docker(['inspect','--format','{{.State.Health.Status}}',id]),
      'healthy','Unhealthy fixture before cutover');
  }
  const uuidPrimary=await scopedDb(primary,async db=>{
    report.environment.primaryVersion=db.info.version;
    const uuid=(await db.query('SELECT @@server_uuid AS identity')).rows[0].identity;
    await db.query('CREATE TABLE '+table+
      ' (token CHAR(36) NOT NULL PRIMARY KEY, value INT NOT NULL) ENGINE=InnoDB');
    createdPrimary=true;
    await db.transaction(async tx=>{
      await tx.query('INSERT INTO '+table+' (token,value) VALUES (?,?)',[token,1]);
      report.outcome.originalWriteExecutions++;
    });
    const row=await db.query(
      'SELECT COUNT(*) AS n FROM '+table+' WHERE token = ?',[token]);
    assert.equal(row.rows[0].n,1n);
    report.outcome.primaryCommittedBeforeCrash=true;
    return uuid;
  });
  const uuidStandby=await scopedDb(standby,async db=>{
    report.environment.standbyVersion=db.info.version;
    const uuid=(await db.query('SELECT @@server_uuid AS identity')).rows[0].identity;
    await db.query('CREATE TABLE '+table+
      ' (token CHAR(36) NOT NULL PRIMARY KEY, value INT NOT NULL) ENGINE=InnoDB');
    createdStandby=true;
    const row=await db.query(
      'SELECT COUNT(*) AS n FROM '+table+' WHERE token = ?',[token]);
    assert.equal(row.rows[0].n,0n,'Unreplicated standby unexpectedly has token');
    return uuid;
  });
  assert.ok(typeof uuidPrimary==='string'&&typeof uuidStandby==='string'&&
    uuidPrimary!==uuidStandby,'Both endpoints must be distinct MySQL servers');
  report.environment.distinctServerIdentities=true;

  let armed=false;
  let resolveSent;
  const commandSent=new Promise(resolve=>{resolveSent=resolve;});
  pool=new ConnectionPool(async()=>{
    const db=await connectDatabase(primary);
    assert.equal(db.info.version,version);
    const send=db.send.bind(db);
    db.send=async body=>{
      await send(body);
      if(armed&&body[0]===0x17){armed=false;resolveSent();}
    };
    return db;
  },{maxConnections:1,acquireTimeoutMs:12000,healthCheckTimeoutMs:2000});
  await pool.withConnection(async lease=>{
    assert.equal((await lease.query('SELECT ? AS ready',[7])).rows[0].ready,7n);
  });
  armed=true;
  const active=pool.withConnection(lease=>
    lease.query('SELECT SLEEP(?) AS interrupted',[15]));
  void active.catch(()=>{});
  await Promise.race([
    commandSent,
    sleep(8000).then(()=>{throw Error('Query not issued before server crash');})
  ]);
  await docker(['kill','--signal=KILL',primaryId],15000);
  crashed=true;
  report.outcome.primaryKilled=true;
  const failed=await Promise.race([
    active.then(()=>({ok:true}),e=>({ok:false,code:e?.code})),
    sleep(12000).then(()=>({ok:true,timeout:true}))
  ]);
  assert.deepEqual(failed,{ok:false,code:'CONNECTION_CLOSED'});
  report.outcome.inflightQueryInterrupted=true;
  await until(()=>pool.stats.discarded>=1,5000,'Old native pool was not retired');
  report.outcome.oldPoolDiscarded=true;

  // Explicitly open an independent new connection. This node has never
  // received replication; a health probe cannot authorise promotion.
  await scopedDb(standby,async db=>{
    assert.equal((await db.query('SELECT ? AS healthy',[8])).rows[0].healthy,8n);
    report.outcome.standbyReachableAfterCrash=true;
    const row=await db.query(
      'SELECT COUNT(*) AS n FROM '+table+' WHERE token = ?',[token]);
    report.outcome.standbyCommittedTokenCount=Number(row.rows[0].n);
    assert.equal(row.rows[0].n,0n);
  });
  const decision=assessTwoNodeCutover({
    primaryCommitted:report.outcome.primaryCommittedBeforeCrash,
    standbyHasToken:false
  });
  assert.equal(decision.resumeWrites,false);
  assert.equal(decision.replayOriginalWrite,false);
  report.outcome.cutoverDecision=decision.decision;
  report.outcome.resumeWrites=decision.resumeWrites;

  await docker(['start',primaryId],30000);
  restarted=true;
  await until(async()=>await docker(
    ['inspect','--format','{{.State.Health.Status}}',primaryId],5000
  )==='healthy',90000,'Original MySQL primary did not recover');
  report.outcome.primaryRestored=true;
  report.cleanup.primaryServerHealthy=true;
  await scopedDb(primary,async db=>{
    const row=await db.query(
      'SELECT COUNT(*) AS n FROM '+table+' WHERE token = ?',[token]);
    assert.equal(row.rows[0].n,1n,'Originally committed data must survive restart');
    report.outcome.primaryCommittedTokenCountAfterRestart=Number(row.rows[0].n);
  });
}catch(error){
  report.status='failed';
  report.failureCode=/^[A-Z_]{2,40}$/.test(error?.code??'')
    ?error.code:'QUALIFICATION_FAILED';
  process.exitCode=1;
}finally{
  if(crashed&&!restarted){
    try{await docker(['start',primaryId],30000);restarted=true;}catch{}
  }
  if(restarted&&!report.cleanup.primaryServerHealthy){
    try{
      await until(async()=>await docker(
        ['inspect','--format','{{.State.Health.Status}}',primaryId],5000
      )==='healthy',90000,'Original primary unavailable');
      report.cleanup.primaryServerHealthy=true;
    }catch{}
  }
  if(pool){
    try{
      await pool.close();
      report.resources.primaryPoolCreated=pool.stats.created;
      report.resources.primaryPoolDiscarded=pool.stats.discarded;
      report.resources.primaryPoolAfterClose=pool.stats.size;
      report.resources.pendingAfterClose=pool.stats.pending;
    }catch{
      report.status='failed';report.failureCode??='CLEANUP_FAILED';
      process.exitCode=1;
    }
  }
  for(const [created,t,key] of [
    [createdPrimary,primary,'primaryTableDropped'],
    [createdStandby,standby,'standbyTableDropped']
  ]){
    if(created)try{
      await scopedDb(t,db=>db.query('DROP TABLE IF EXISTS '+table));
      report.cleanup[key]=true;
    }catch{
      report.status='failed';report.failureCode??='CLEANUP_FAILED';
      process.exitCode=1;
    }
  }
  report.elapsedMs=Math.round((performance.now()-start)*1000)/1000;
  if(report.status==='running'){
    try{
      validateTwoNodeCutoverEvidence({...report,status:'passed'},{
        revision,runId,version
      });
      report.status='passed';
    }catch{
      report.status='failed';report.failureCode='EVIDENCE_INVALID';
      process.exitCode=1;
    }
  }
  const out=resolve('artifacts/qualification');
  mkdirSync(out,{recursive:true});
  const path=resolve(out,'mysql-two-node-cutover-'+runId+'.json');
  writeFileSync(path,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({
    report:path,status:report.status,
    distinctServers:report.environment.distinctServerIdentities,
    primaryKilled:report.outcome.primaryKilled,
    standbyTokenCount:report.outcome.standbyCommittedTokenCount,
    primaryRestored:report.outcome.primaryRestored,
    decision:report.outcome.cutoverDecision,
    originalWriteReplays:report.outcome.originalWriteReplays,
    failureCode:report.failureCode
  }));
}
