#!/usr/bin/env node
/**
 * CI-ONLY disposable verified-TLS MySQL server-enforced fencing epoch test.
 * The guarded stored routine owns its transaction and SELECT ... FOR UPDATE.
 * Restricted clients can EXECUTE it but have NO direct table permissions.
 * Not a distributed elector, independent authority store or production API.
 */
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {arch,platform} from 'node:os';
import {connectDatabase} from '../../packages/driver/dist/index.js';
import {validateEpochEvidence} from './fencing-epoch-evidence.mjs';

const revision=process.env.GITHUB_SHA,runId=process.env.GITHUB_RUN_ID;
const version='8.4.13';
if(process.env.CI!=='true'||process.env.NUBLOX_LIVE_MYSQL_AUTHORITY!=='1'||
  process.env.NUBLOX_AUTHORITY_DISPOSABLE_RESTART!=='1'||
  process.env.NUBLOX_TEST_MYSQL_VERSION!==version||
  !/^[0-9a-f]{40}$/.test(revision??'')||!/^[0-9]+$/.test(runId??'')||
  !process.env.NUBLOX_TLS_CA_FILE||!process.env.RUNNER_TEMP)
  throw Error('Refusing fencing epoch qualification without pinned isolated TLS CI fixture');

const started=performance.now();
const docker=promisify(execFile);
const dockerRun=async(args,timeout=30000)=>
  (await docker('docker',args,{timeout,maxBuffer:128*1024})).stdout.trim();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const ca=readFileSync(process.env.NUBLOX_TLS_CA_FILE,'utf8');
const target=(user,password)=>({
  engine:'mysql',host:'127.0.0.1',port:3307,user,password,
  database:'nublox_test',security:'verified-tls',serverName:'localhost',
  ca,timeoutMs:15000
});
const admin=target('root','test-password');
const suffix=randomBytes(6).toString('hex');
const nameA='nbxa'+suffix,nameB='nbxb'+suffix;
const passA=randomBytes(24).toString('hex'),passB=randomBytes(24).toString('hex');
const roles={
  [nameA]:target(nameA,passA),
  [nameB]:target(nameB,passB)
};
const authority='nbx_epoch_authority_'+suffix;
const operations='nbx_epoch_operations_'+suffix;
const procedure='nbx_epoch_apply_'+suffix;
const id=s=>'\`'+s+'\`';
const tab=s=>id('nublox_test')+'.'+id(s);
const report={
  schemaVersion:1,kind:'mysql-transactional-fencing-epoch',
  status:'running',failureCode:null,revision,runId,
  environment:{ci:true,node:process.version,platform:platform(),arch:arch(),
    serverImage:'mysql:8.4.13',serverVersion:null,transport:'verified-tls',
    distinctRestrictedPrincipals:false,mysqlEnforcedRoutine:false},
  fencing:{initialEpoch:1,initialHolderWrite:0,
    wrongHolderRejected:false,futureEpochRejected:false,
    readAccessDenied:false,directWriteDenied:false,epochAdvanceCAS:null,
    previousHolderRejected:false,oldEpochNewHolderRejected:false,
    newHolderWrite:0,impersonationRejected:false,staleAdminCAS:null,
    duplicateOperationRejected:false,competingAdvances:0,
    competingCASWinners:0,finalEpoch:null,finalEpochWriterAccepted:false,
    staleEpochWriterRejected:false,totalSuccessfulOperationTokens:0,
    automaticReplays:0},
  restart:{serverRestarted:false,persistedEpoch:null,
    staleWriterRejected:false,currentWriterAccepted:false,
    totalSuccessfulOperationTokensAfterRestart:0},
  cleanup:{fixtureDropped:false,principalsRemoved:false,
    mysqlRestored:false},elapsedMs:null
};
const tableNames=[authority,operations];
const allTokens=[];
let stage='docker-fixture';
let setup=false,restarted=false;
let actorA,actorB;
let finalHolder;
async function inSession(t,fn){
  const db=await connectDatabase(t);
  try{return await fn(db);}finally{await db.close();}
}
async function authRows(db){
  return (await db.query('SELECT epoch,holder FROM '+tab(authority)+
    ' WHERE authority_id=1')).rows[0];
}
async function countOperations(db){
  return Number((await db.query('SELECT COUNT(*) AS n FROM '+
    tab(operations))).rows[0].n);
}
async function call(db,epoch,token,value){
  return db.query('CALL '+tab(procedure)+'(?,?,?)',[epoch,token,value]);
}
async function rejectsStale(db,epoch){
  await assert.rejects(call(db,epoch,randomUUID(),900),e=>
    e?.code==='DATABASE_ERROR'&&e?.sqlState==='45000',
    'MySQL must reject an invalid epoch or authenticated holder');
}
async function adminCAS(expected,holder,next){
  return inSession(admin,async db=>{
    const result=await db.query('UPDATE '+tab(authority)+
      ' SET epoch=?,holder=? WHERE authority_id=1 AND epoch=? AND holder=?',
      [expected+1,next,expected,holder]);
    return result.affectedRows;
  });
}
const wait=async(fn,limit,message)=>{
  const deadline=performance.now()+limit;
  while(performance.now()<deadline){
    try{if(await fn())return;}catch{}
    await pause(300);
  }
  throw Error(message);
};
try{
  assert.equal(await dockerRun(['inspect','--format','{{.Config.Image}}',
    'nubloxsql-mysql-tls']), 'mysql:'+version);
  assert.equal(await dockerRun(['inspect','--format',
    '{{.State.Running}}','nubloxsql-mysql-tls']),'true');
  stage='create-isolated-privilege-fixture';
  await inSession(admin,async db=>{
    assert.equal(db.info.version,version);
    assert.equal(db.info.transport,'verified-tls');
    report.environment.serverVersion=db.info.version;
    stage='create-authority-table';
    await db.query('CREATE TABLE '+tab(authority)+
      ' (authority_id INT NOT NULL PRIMARY KEY,epoch BIGINT UNSIGNED NOT NULL,'+
      'holder VARCHAR(32) NOT NULL) ENGINE=InnoDB');
    setup=true;
    stage='create-operation-table';
    await db.query('CREATE TABLE '+tab(operations)+
      ' (operation_token CHAR(36) NOT NULL PRIMARY KEY,'+
      'epoch BIGINT UNSIGNED NOT NULL,holder VARCHAR(32) NOT NULL,'+
      'payload INT NOT NULL) ENGINE=InnoDB');
    stage='seed-authority-row';
    await db.query('INSERT INTO '+tab(authority)+
      ' (authority_id,epoch,holder) VALUES (1,1,?)',[nameA]);
    // Routine is security-definer; USER() is the *authenticated login*.
    // SELECT ... FOR UPDATE and INSERT occur in one MySQL transaction.
    // A stale connection may still exist, but cannot bypass epoch check.
    const sql='CREATE PROCEDURE '+tab(procedure)+
      ' (IN requested_epoch BIGINT UNSIGNED,'+
      ' IN requested_token CHAR(36),IN requested_payload INT) '+
      'SQL SECURITY DEFINER BEGIN '+
      'DECLARE active_epoch BIGINT UNSIGNED;'+
      'DECLARE active_holder VARCHAR(32);'+
      'DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;'+
      'START TRANSACTION;'+
      'SELECT epoch,holder INTO active_epoch,active_holder FROM '+
      tab(authority)+' WHERE authority_id=1 FOR UPDATE;'+
      "IF active_epoch <> requested_epoch OR active_holder <> "+
      "SUBSTRING_INDEX(USER(),'@',1) THEN "+
      "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fencing epoch denied';"+
      'END IF;'+
      'INSERT INTO '+tab(operations)+
      ' (operation_token,epoch,holder,payload) VALUES '+
      "(requested_token,requested_epoch,SUBSTRING_INDEX(USER(),'@',1),"+
      'requested_payload);COMMIT;END';
    stage='create-guarded-routine';
    await db.query(sql);
    for(const [user,password] of [[nameA,passA],[nameB,passB]]){
      stage='create-restricted-principal';
      await db.query("CREATE USER '"+user+"'@'%' IDENTIFIED WITH "+
        "caching_sha2_password BY '"+password+"' REQUIRE SSL");
      stage='grant-restricted-execute';
      await db.query('GRANT EXECUTE ON PROCEDURE '+tab(procedure)+
        " TO '"+user+"'@'%'");
    }
  });
  report.environment.distinctRestrictedPrincipals=true;
  report.environment.mysqlEnforcedRoutine=true;
  actorA=await connectDatabase(roles[nameA]);
  actorB=await connectDatabase(roles[nameB]);
  assert.equal(actorA.info.transport,'verified-tls');
  assert.equal(actorB.info.transport,'verified-tls');
  stage='read-and-write-privilege-barrier';
  const identify=async db=>(await db.query('SELECT USER() AS who')).rows[0].who;
  assert.ok((await identify(actorA)).startsWith(nameA+'@'));
  assert.ok((await identify(actorB)).startsWith(nameB+'@'));
  await assert.rejects(actorA.query('SELECT * FROM '+tab(authority)),
    e=>e?.code==='DATABASE_ERROR'&&e?.vendorCode===1142);
  report.fencing.readAccessDenied=true;
  await assert.rejects(actorA.query('INSERT INTO '+tab(operations)+
    ' (operation_token,epoch,holder,payload) VALUES (?,?,?,?)',
    [randomUUID(),1,nameA,4]),
    e=>e?.code==='DATABASE_ERROR'&&e?.vendorCode===1142);
  report.fencing.directWriteDenied=true;

  stage='epoch-one-and-identity';
  const firstToken=randomUUID();
  await call(actorA,1,firstToken,101);
  allTokens.push(firstToken);
  report.fencing.initialHolderWrite=1;
  await rejectsStale(actorB,1);
  report.fencing.wrongHolderRejected=true;
  await rejectsStale(actorA,2);
  report.fencing.futureEpochRejected=true;

  stage='trusted-epoch-transition';
  report.fencing.epochAdvanceCAS=await adminCAS(1,nameA,nameB);
  assert.equal(report.fencing.epochAdvanceCAS,1);
  await rejectsStale(actorA,1);
  report.fencing.previousHolderRejected=true;
  await rejectsStale(actorB,1);
  report.fencing.oldEpochNewHolderRejected=true;
  const secondToken=randomUUID();
  await call(actorB,2,secondToken,102);
  allTokens.push(secondToken);
  report.fencing.newHolderWrite=1;
  await rejectsStale(actorA,2);
  report.fencing.impersonationRejected=true;
  report.fencing.staleAdminCAS=await adminCAS(1,nameA,nameA);
  assert.equal(report.fencing.staleAdminCAS,0);
  await assert.rejects(call(actorB,2,secondToken,102),
    e=>e?.code==='DATABASE_ERROR'&&e?.vendorCode===1062);
  report.fencing.duplicateOperationRejected=true;

  stage='competing-trusted-cas';
  const advances=await Promise.all([
    adminCAS(2,nameB,nameA),
    adminCAS(2,nameB,nameB)
  ]);
  report.fencing.competingAdvances=advances.length;
  report.fencing.competingCASWinners=advances.filter(x=>x===1).length;
  assert.deepEqual([...advances].sort(),[0,1],
    'Exactly one source epoch transition may succeed');
  finalHolder=advances[0]===1?nameA:nameB;
  await inSession(admin,async db=>{
    const current=await authRows(db);
    assert.equal(current.epoch,3n);
    assert.equal(current.holder,finalHolder);
    report.fencing.finalEpoch=Number(current.epoch);
  });
  await rejectsStale(actorA,2);
  await rejectsStale(actorB,2);
  report.fencing.staleEpochWriterRejected=true;
  const winner=finalHolder===nameA?actorA:actorB;
  const thirdToken=randomUUID();
  await call(winner,3,thirdToken,103);
  allTokens.push(thirdToken);
  report.fencing.finalEpochWriterAccepted=true;
  await inSession(admin,async db=>{
    assert.equal(await countOperations(db),3);
    for(const token of allTokens){
      const matches=(await db.query('SELECT COUNT(*) AS n FROM '+
        tab(operations)+' WHERE operation_token=?',[token])).rows[0].n;
      assert.equal(matches,1n);
    }
  });
  report.fencing.totalSuccessfulOperationTokens=3;

  stage='restart-mysql-server-with-durable-epoch';
  await actorA.close();await actorB.close();
  actorA=actorB=null;
  // Exactly the disposable TLS fixture, never an externally supplied ID.
  await dockerRun(['restart','--time=0','nubloxsql-mysql-tls'],45000);
  restarted=true;
  await wait(async()=>inSession(admin,async db=>{
    const current=await authRows(db);
    return current.epoch===3n&&current.holder===finalHolder;
  }),90000,'Durable fencing epoch unavailable following real restart');
  report.cleanup.mysqlRestored=true;
  report.restart.serverRestarted=true;
  report.restart.persistedEpoch=3;
  const stale=await connectDatabase(roles[nameA]);
  try{
    await rejectsStale(stale,1);
    report.restart.staleWriterRejected=true;
  }finally{await stale.close();}
  const admitted=await connectDatabase(roles[finalHolder]);
  try{
    const fourthToken=randomUUID();
    await call(admitted,3,fourthToken,104);
    allTokens.push(fourthToken);
    report.restart.currentWriterAccepted=true;
  }finally{await admitted.close();}
  await inSession(admin,async db=>{
    assert.equal(await countOperations(db),4);
  });
  report.restart.totalSuccessfulOperationTokensAfterRestart=4;
}catch(error){
  report.status='failed';
  report.failureStage=stage;
  // Only MySQL's numeric error ID and validated five-character SQLSTATE.
  // Never persist server messages or failing SQL: fixture setup has secrets.
  report.failureVendorCode=Number.isInteger(error?.vendorCode)?
    error.vendorCode:null;
  report.failureSqlState=/^[A-Z0-9]{5}$/.test(error?.sqlState??'')?
    error.sqlState:null;
  report.failureCode=/^[A-Z_]{2,40}$/.test(error?.code??'')?
    error.code:'QUALIFICATION_FAILED';
  process.exitCode=1;
}finally{
  for(const db of [actorA,actorB]){
    try{if(db)await db.close();}catch{}
  }
  // If the restart fails, try to restore the isolated service for cleanup.
  try{
    const state=await dockerRun(['inspect','--format','{{.State.Running}}',
      'nubloxsql-mysql-tls'],10000);
    if(state!=='true')await dockerRun(['start','nubloxsql-mysql-tls'],45000);
    await wait(async()=>inSession(admin,db=>db.query('SELECT 1')),
      90000,'Fixture never returned to an authenticated ready state');
    report.cleanup.mysqlRestored=true;
  }catch{
    report.status='failed';report.failureCode??='CLEANUP_FAILED';
    process.exitCode=1;
  }
  if(setup&&report.cleanup.mysqlRestored){
    try{
      await inSession(admin,async db=>{
        await db.query('DROP PROCEDURE IF EXISTS '+tab(procedure));
        for(const t of [operations,authority])
          await db.query('DROP TABLE IF EXISTS '+tab(t));
      });
      report.cleanup.fixtureDropped=true;
    }catch{
      report.status='failed';report.failureCode??='CLEANUP_FAILED';
      process.exitCode=1;
    }
  }
  if(report.cleanup.mysqlRestored){
    try{
      await inSession(admin,async db=>{
        for(const name of [nameA,nameB])
          await db.query("DROP USER IF EXISTS '"+name+"'@'%'");
      });
      report.cleanup.principalsRemoved=true;
    }catch{
      report.status='failed';report.failureCode??='CLEANUP_FAILED';
      process.exitCode=1;
    }
  }
  report.elapsedMs=Math.round((performance.now()-started)*1000)/1000;
  if(report.status==='running'){
    try{
      validateEpochEvidence({...report,status:'passed'},{revision,runId,version});
      report.status='passed';
    }catch{
      report.status='failed';report.failureCode='EVIDENCE_INVALID';
      process.exitCode=1;
    }
  }
  const dir=resolve('artifacts/qualification');
  mkdirSync(dir,{recursive:true});
  const path=resolve(dir,'mysql-fencing-epoch-'+runId+'.json');
  writeFileSync(path,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({
    status:report.status,report:path,
    finalEpoch:report.fencing.finalEpoch,
    competingCASWinners:report.fencing.competingCASWinners,
    restartRetainedEpoch:report.restart.persistedEpoch===3,
    staleWriterRejected:report.restart.staleWriterRejected,
    fixtureCleaned:report.cleanup.fixtureDropped,
    failureCode:report.failureCode,failureStage:report.failureStage??null,
    failureVendorCode:report.failureVendorCode??null,
    failureSqlState:report.failureSqlState??null
  }));
}
