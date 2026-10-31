#!/usr/bin/env node
/**
 * DESTRUCTIVE CI-ONLY COMMIT crash qualification against an exact disposable
 * Docker MySQL 8.4.13 service. Do NOT run against production/customer MySQL.
 * The report contains no SQL, credentials, table name, operation token or rows.
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
import {validateCommitCrashEvidence} from './commit-crash-evidence.mjs';

const exec=promisify(execFile),started=performance.now();
const version=process.env.NUBLOX_QUALIFICATION_MYSQL_VERSION;
const container=process.env.NUBLOX_QUALIFICATION_CONTAINER;
const revision=process.env.GITHUB_SHA,runId=process.env.GITHUB_RUN_ID;
if(process.env.CI!=='true'||process.env.NUBLOX_LIVE_MYSQL!=='1'||
  process.env.NUBLOX_ALLOW_DESTRUCTIVE_MYSQL_FIXTURE!=='1'||
  version!=='8.4.13'||!/^[0-9a-f]{12,64}$/.test(container??'')||
  !/^[0-9a-f]{40}$/.test(revision??'')||!/^[0-9]+$/.test(runId??''))
  throw Error('Refusing destructive operation outside exact CI MySQL fixture');
const target={
  engine:'mysql',host:'127.0.0.1',port:Number(process.env.MYSQL_PORT??3306),
  user:process.env.MYSQL_USER??'root',
  password:process.env.MYSQL_PASSWORD??'test-password',
  database:process.env.MYSQL_DATABASE??'nublox_test',
  security:'isolated-local',timeoutMs:20000
};
assert.ok(Number.isSafeInteger(target.port)&&target.port>0&&target.port<=65535);
const docker=async(args,timeout=30000)=>
  (await exec('docker',args,{timeout,maxBuffer:128*1024})).stdout.trim();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,limit,message){
  const deadline=performance.now()+limit;
  do{
    try{if(await check())return;}catch{}
    await sleep(250);
  }while(performance.now()<deadline);
  throw Error(message);
}
const pinned=actual=>actual===version||actual.startsWith(version+'-');
const table='nublox_commit_crash_'+randomUUID().replaceAll('-','').slice(0,16);
const token=randomUUID();
const report={
  schemaVersion:1,kind:'mysql-commit-crash-reconciliation',status:'running',
  revision,runId,environment:{
    ci:true,node:process.version,platform:platform(),arch:arch(),
    image:'mysql:'+version,serverVersion:null,transport:'isolated-local'
  },
  fault:{commitWriteCount:0,crashAfterCommitWrite:false,
    serverKilled:false,oldSessionRetired:false,unknownOutcome:false,
    transactionCallbacks:0,insertExecutions:0},
  reconciliation:{independentRead:false,durableTokenCount:null,
    freshPoolQuery:false},
  pool:{created:0,discarded:0,pendingAfterRecovery:null,
    sizeAfterClose:null,pendingAfterClose:null},
  cleanup:{tableDropped:false,mysqlRestored:false},
  failureCode:null,elapsedMs:null
};
let pool,createdTable=false,killed=false,restarted=false,commitSocket=null;
let signalCommit;
const sentCommit=new Promise(resolve=>{signalCommit=resolve;});
let armed=false;
try{
  assert.equal(await docker(['inspect','--format','{{.Config.Image}}',container]),
    'mysql:'+version,'Unapproved database image');
  assert.equal(await docker(['inspect','--format','{{.State.Health.Status}}',container]),
    'healthy','Database fixture is not healthy');
  const setup=await connectDatabase(target);
  try{
    assert.ok(pinned(setup.info.version),'Wrong MySQL patch');
    report.environment.serverVersion=setup.info.version;
    await setup.query('CREATE TABLE '+table+
      ' (token CHAR(36) PRIMARY KEY, amount INT NOT NULL) ENGINE=InnoDB');
    createdTable=true;
  }finally{await setup.close();}
  pool=new ConnectionPool(async()=>{
    const db=await connectDatabase(target);
    assert.ok(pinned(db.info.version));
    const send=db.stream.send.bind(db.stream);
    db.stream.send=async frame=>{
      const committing=frame[0]===0x03&&
        frame.subarray(1).toString('ascii')==='COMMIT';
      if(armed&&committing){
        armed=false;
        report.fault.commitWriteCount++;
        // Withhold any server COMMIT acknowledgement. The single native
        // COMMIT frame is written first; only then does CI kill mysqld.
        db.socket.pause();
        commitSocket=db.socket;
        await send(frame);
        signalCommit();
        return;
      }
      return send(frame);
    };
    return db;
  },{maxConnections:1,acquireTimeoutMs:12000,healthCheckTimeoutMs:2000});
  // Check ordinary pooled session before its transaction becomes ambiguous.
  await pool.withConnection(async lease=>{
    assert.equal((await lease.query('SELECT ? AS ok',[21])).rows[0].ok,21n);
  });
  const pending=pool.withConnection(lease=>lease.transaction(async tx=>{
    report.fault.transactionCallbacks++;
    await tx.query('INSERT INTO '+table+' (token, amount) VALUES (?,?)',[token,71]);
    report.fault.insertExecutions++;
    armed=true;
  }));
  void pending.catch(()=>{});
  await Promise.race([
    sentCommit,
    sleep(8000).then(()=>{throw Error('COMMIT never reached client send hook');})
  ]);
  assert.equal(report.fault.commitWriteCount,1,'Driver must send COMMIT only once');
  await docker(['kill','--signal=KILL',container],15000);
  killed=true;
  report.fault.serverKilled=true;
  report.fault.crashAfterCommitWrite=true;
  // Ensure ACK queued in paused TCP buffers can NEVER be mistaken for a
  // confirmed commit after the real service was killed.
  commitSocket.destroy();
  const outcome=await Promise.race([
    pending.then(()=>({ok:true}),e=>({ok:false,code:e?.code})),
    sleep(15000).then(()=>({ok:true,timeout:true}))
  ]);
  assert.deepEqual(outcome,{ok:false,code:'TRANSACTION_OUTCOME_UNKNOWN'},
    'Unacknowledged COMMIT must be uncertain, even across actual mysqld SIGKILL');
  report.fault.unknownOutcome=true;
  await until(()=>pool.stats.discarded>=1,5000,'Failed pool session was not discarded');
  report.fault.oldSessionRetired=true;
  await docker(['start',container],30000);
  restarted=true;
  await until(async()=>{
    return await docker(['inspect','--format','{{.State.Health.Status}}',container],5000)==='healthy';
  },90000,'MySQL did not recover to healthy after SIGKILL');
  report.cleanup.mysqlRestored=true;

  // Server crash may roll back the write OR preserve a durable COMMIT. Do
  // NOT infer which from the client exception. Query authoritative state.
  const verifier=await connectDatabase(target);
  try{
    assert.ok(pinned(verifier.info.version));
    const result=await verifier.query(
      'SELECT COUNT(*) AS n FROM '+table+' WHERE token = ?',[token]);
    assert.ok(result.rows[0].n===0n||result.rows[0].n===1n,
      'Reconciliation must return a unique operation token count');
    report.reconciliation.independentRead=true;
    report.reconciliation.durableTokenCount=Number(result.rows[0].n);
  }finally{await verifier.close();}
  const recovered=await pool.withConnection(async lease=>
    (await lease.query('SELECT ? AS recovered',[72])).rows[0].recovered
  );
  assert.equal(recovered,72n,'Replacement pool session did not recover');
  report.reconciliation.freshPoolQuery=true;
  assert.ok(pool.stats.created>=2&&pool.stats.discarded>=1);
  assert.equal(pool.stats.pending,0);
  report.pool.pendingAfterRecovery=pool.stats.pending;
  assert.equal(report.fault.transactionCallbacks,1);
  assert.equal(report.fault.insertExecutions,1);
  assert.equal(report.fault.commitWriteCount,1);
}catch(error){
  report.status='failed';
  report.failureCode=/^[A-Z_]{2,40}$/.test(error?.code??'')?
    error.code:'QUALIFICATION_FAILED';
  process.exitCode=1;
}finally{
  // Restore even on failure, never leave CI's disposable fixture down.
  if(killed&&!restarted){
    try{await docker(['start',container],30000);restarted=true;}catch{}
  }
  if(restarted&&!report.cleanup.mysqlRestored){
    try{
      await until(async()=>await docker(
        ['inspect','--format','{{.State.Health.Status}}',container],5000)==='healthy',
      90000,'Recovery after failure timed out');
      report.cleanup.mysqlRestored=true;
    }catch{}
  }
  try{
    if(pool){
      report.pool.created=pool.stats.created;
      report.pool.discarded=pool.stats.discarded;
      await pool.close();
      report.pool.sizeAfterClose=pool.stats.size;
      report.pool.pendingAfterClose=pool.stats.pending;
    }
  }catch{
    report.status='failed';
    report.failureCode??='CLEANUP_FAILED';
    process.exitCode=1;
  }
  if(createdTable){
    try{
      const cleanup=await connectDatabase(target);
      try{await cleanup.query('DROP TABLE IF EXISTS '+table);}
      finally{await cleanup.close();}
      report.cleanup.tableDropped=true;
    }catch{
      report.status='failed';
      report.failureCode??='CLEANUP_FAILED';
      process.exitCode=1;
    }
  }
  report.elapsedMs=Math.round((performance.now()-started)*1000)/1000;
  if(report.status==='running'){
    try{
      validateCommitCrashEvidence({...report,status:'passed'},{
        revision,runId,version
      });
      report.status='passed';
    }catch{
      report.status='failed';
      report.failureCode='EVIDENCE_INVALID';
      process.exitCode=1;
    }
  }
  const directory=resolve('artifacts/qualification');
  mkdirSync(directory,{recursive:true});
  const file=resolve(directory,'mysql-commit-crash-'+runId+'.json');
  writeFileSync(file,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({
    report:file,status:report.status,revision,runId,
    serverKilled:report.fault.serverKilled,
    unknownOutcome:report.fault.unknownOutcome,
    durableTokenCount:report.reconciliation.durableTokenCount,
    poolSlotsAfterClose:report.pool.sizeAfterClose,
    failureCode:report.failureCode
  }));
}
