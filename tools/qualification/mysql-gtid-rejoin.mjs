#!/usr/bin/env node
/**
 * DESTRUCTIVE CI-ONLY GTID replication and explicitly authorised promotion
 * with two isolated disposable MySQL 8.4.13 containers. Not a production
 * topology controller or general-purpose replica configuration system.
 * Never targets customer, shared or production servers.
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
import {assessFencedPromotion} from './gtid-promotion-evidence.mjs';
import {validateFormerPrimaryRejoinEvidence}
  from './gtid-rejoin-evidence.mjs';

const exec=promisify(execFile),started=performance.now();
const revision=process.env.GITHUB_SHA,runId=process.env.GITHUB_RUN_ID;
const sourceId=process.env.NUBLOX_GTID_SOURCE_CONTAINER;
const replicaId=process.env.NUBLOX_GTID_REPLICA_CONTAINER;
const network=process.env.NUBLOX_GTID_NETWORK;
const version='8.4.13';
if(process.env.CI!=='true'||process.env.NUBLOX_LIVE_MYSQL!=='1'||
   process.env.NUBLOX_ALLOW_DESTRUCTIVE_MYSQL_FIXTURE!=='1'||
   process.env.NUBLOX_TEST_PROMOTION_APPROVAL!=='1'||
   process.env.NUBLOX_QUALIFICATION_MYSQL_VERSION!==version||
   !/^[a-f0-9]{40}$/.test(revision??'')||
   !/^[0-9]+$/.test(runId??'')||
   !/^[a-f0-9]{12,64}$/.test(sourceId??'')||
   !/^[a-f0-9]{12,64}$/.test(replicaId??'')||
   sourceId===replicaId||network!=='nublox-gtid-'+runId)
  throw Error('Refusing GTID promotion outside a pinned authorised CI fixture');

const docker=async(args,timeout=30000)=>
  (await exec('docker',args,{timeout,maxBuffer:128*1024})).stdout.trim();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,limit,message){
  const stop=performance.now()+limit;
  while(performance.now()<stop){
    try{if(await predicate())return;}catch{}
    await sleep(250);
  }
  throw Error(message);
}
const target=p=>({
  engine:'mysql',host:'127.0.0.1',port:p,user:'root',
  password:process.env.MYSQL_PASSWORD??'test-password',
  security:'isolated-local',timeoutMs:15000
});
const source=target(3306),replica=target(3307);
const inSchema=(t)=>({...t,database:'nublox_ha_test'});
async function session(t,work){
  const db=await connectDatabase(t);
  try{
    assert.equal(db.info.version,version,'Unexpected database patch');
    return await work(db);
  }finally{await db.close();}
}
const firstToken=randomUUID(),secondToken=randomUUID(),rejectedToken=randomUUID();
const report={
  schemaVersion:1,kind:'mysql-gtid-former-primary-rejoin',
  status:'running',failureCode:null,revision,runId,
  environment:{
    ci:true,node:process.version,platform:platform(),arch:arch(),
    transport:'isolated-local',primaryImage:'mysql:'+version,
    replicaImage:'mysql:'+version,primaryVersion:null,replicaVersion:null,
    distinctServerIds:false
  },
  replication:{
    gtidModeOnBoth:false,autoPosition:false,
    replicaReadOnlyBefore:false,sourceCommitAcknowledged:false,
    appliedGtidWaitResult:null,originalTokenOnReplica:null,
    replicationReceiverRunning:false,replicationApplierRunning:false
  },
  promotion:{
    primaryKilled:false,primaryFencedAtPromotion:false,
    operatorApproved:false,replicationStopped:false,
    replicationConfigurationCleared:false,
    replicaWritableAfterPromotion:false,promotedWriteAcknowledged:false,
    promotedTokenCount:null,originalTokenCountAfterPromotion:null,
    oldPrimaryRemainedDown:false,noAutomaticReplay:false,
    originalWriteExecutions:0,promotedWriteExecutions:0,
    promotionDecision:'blocked'
  },
  rejoin:{persistedSuperReadOnlyBeforeCrash:false,
    restartHealthy:false,persistedSuperReadOnlyAfterRestart:false,
    rejectedOldPrimaryWrite:false,oldPrimaryWriteAttempts:0,
    noUnexpectedOldPrimaryWrites:false,
    reverseAutoPosition:false,receiverRunning:false,applierRunning:false,
    reverseGtidCatchupResult:null,originalTokenCount:null,
    promotedTokenCount:null,superReadOnlyAfterCatchup:false,
    oldPrimaryStillReadOnly:false,promotedPrimaryStillWritable:false},
  cleanup:{isolatedFixturesDisposed:false},elapsedMs:null
};
const labels={source:'source',replica:'replica'};
const refs=[{id:sourceId,role:'source'},{id:replicaId,role:'replica'}];
let stage='docker-identity';
try{
  for(const {id,role} of refs){
    assert.equal(await docker(['inspect','--format','{{.Config.Image}}',id]),
      'mysql:'+version,'Only the exact image is authorised');
    assert.equal(await docker(['inspect','--format',
      '{{index .Config.Labels "nublox.qual.run"}}',id]),runId);
    assert.equal(await docker(['inspect','--format',
      '{{index .Config.Labels "nublox.qual.role"}}',id]),labels[role]);
    assert.equal(await docker(['inspect','--format',
      '{{.State.Health.Status}}',id]),'healthy');
    const ip=await docker(['inspect','--format',
      '{{with index .NetworkSettings.Networks "'+network+'"}}{{.IPAddress}}{{end}}',id]);
    assert.match(ip,/^[0-9]{1,3}(\.[0-9]{1,3}){3}$/,
      'Expected a network-scoped IPv4 for each Docker fixture');
  }
  stage='source-settings';
  let sourceUUID,replicaUUID,sourceServerId,replicaServerId;
  await session(source,async db=>{
    report.environment.primaryVersion=db.info.version;
    const r=(await db.query(
      'SELECT @@server_uuid AS uuid, @@server_id AS sid, @@gtid_mode AS gtid, @@log_bin AS bin'
    )).rows[0];
    sourceUUID=r.uuid;sourceServerId=Number(r.sid);
    assert.equal(r.gtid,'ON');assert.equal(Number(r.bin),1);
    await db.query(
      "CREATE USER 'nublox_repl'@'%' IDENTIFIED BY 'fixture-repl-only'");
    await db.query(
      "GRANT REPLICATION SLAVE ON *.* TO 'nublox_repl'@'%'");
  });
  stage='replica-settings';
  await session(replica,async db=>{
    report.environment.replicaVersion=db.info.version;
    const r=(await db.query(
      'SELECT @@server_uuid AS uuid, @@server_id AS sid, @@gtid_mode AS gtid, @@log_bin AS bin'
    )).rows[0];
    replicaUUID=r.uuid;replicaServerId=Number(r.sid);
    assert.equal(r.gtid,'ON');assert.equal(Number(r.bin),1);
  });
  assert.ok(sourceUUID!==replicaUUID&&
    sourceServerId!==replicaServerId&&
    sourceServerId===101&&replicaServerId===102);
  report.environment.distinctServerIds=true;
  report.replication.gtidModeOnBoth=true;

  stage='replication-configure';
  await session(replica,async db=>{
    // This is a test-owned network alias; credentials never enter artifacts.
    await db.query("CHANGE REPLICATION SOURCE TO "+
      "SOURCE_HOST='nublox-gtid-source', SOURCE_PORT=3306, "+
      "SOURCE_USER='nublox_repl', "+
      "SOURCE_PASSWORD='fixture-repl-only', "+
      "SOURCE_AUTO_POSITION=1, GET_SOURCE_PUBLIC_KEY=1");
    await db.query('SET GLOBAL super_read_only=ON');
    const r=(await db.query(
      'SELECT @@global.super_read_only AS sr, @@global.read_only AS ro'
    )).rows[0];
    assert.equal(Number(r.sr),1);assert.equal(Number(r.ro),1);
    report.replication.replicaReadOnlyBefore=true;
    await db.query('START REPLICA');
  });
  stage='replication-start';
  await until(async()=>{
    return session(replica,async db=>{
      const row=(await db.query('SHOW REPLICA STATUS')).rows[0];
      return row?.Replica_IO_Running==='Yes'&&row?.Replica_SQL_Running==='Yes';
    });
  },30000,'GTID replication threads did not start');
  report.replication.replicationReceiverRunning=true;
  report.replication.replicationApplierRunning=true;
  report.replication.autoPosition=true;

  stage='schema-and-commit';
  let sourceGTID;
  await session(source,async db=>{
    await db.query('CREATE DATABASE nublox_ha_test');
  });
  // Wait for the schema to arrive, then the source's bound transaction.
  await until(async()=>{
    try{return await session(inSchema(replica),async db=>{
      const row=(await db.query('SELECT DATABASE() AS current_db')).rows[0];
      return row?.current_db==='nublox_ha_test';
    });}catch{return false;}
  },30000,'Replicated schema never arrived');
  await session(inSchema(source),async db=>{
    await db.query('CREATE TABLE nublox_ha_test.promoted_tokens '+
      '(token CHAR(36) PRIMARY KEY, value INT NOT NULL) ENGINE=InnoDB');
    await db.transaction(async tx=>{
      await tx.query('INSERT INTO promoted_tokens (token,value) VALUES (?,?)',
        [firstToken,71]);
      report.promotion.originalWriteExecutions++;
    });
    report.replication.sourceCommitAcknowledged=true;
    const row=(await db.query('SELECT @@GLOBAL.gtid_executed AS gtid')).rows[0];
    assert.ok(typeof row.gtid==='string'&&row.gtid.length>0);
    sourceGTID=row.gtid;
  });
  stage='gtid-catchup';
  await session(replica,async db=>{
    const result=(await db.query(
      'SELECT WAIT_FOR_EXECUTED_GTID_SET(?, 20) AS caught_up',[sourceGTID]
    )).rows[0];
    report.replication.appliedGtidWaitResult=Number(result.caught_up);
    assert.equal(report.replication.appliedGtidWaitResult,0,
      'Full source GTID set must be applied within deadline');
    const status=(await db.query('SHOW REPLICA STATUS')).rows[0];
    assert.equal(status.Replica_IO_Running,'Yes');
    assert.equal(status.Replica_SQL_Running,'Yes');
    assert.equal(Number(status.Auto_Position),1);
  });
  await session(inSchema(replica),async db=>{
    const result=(await db.query(
      'SELECT COUNT(*) AS n FROM promoted_tokens WHERE token=?',[firstToken]
    )).rows[0];
    report.replication.originalTokenOnReplica=Number(result.n);
    assert.equal(result.n,1n);
  });

  // Persist a strict write fence BEFORE the real server crash. Restarting
  // the former primary must never yield a second writable primary, even if
  // the process is revived before administrative reconfiguration.
  stage='persistent-old-source-fence';
  await session(source,async db=>{
    await db.query('SET PERSIST super_read_only=ON');
    const vars=(await db.query(
      'SELECT @@GLOBAL.super_read_only AS sr, @@GLOBAL.read_only AS ro'
    )).rows[0];
    assert.equal(Number(vars.sr),1);assert.equal(Number(vars.ro),1);
    report.rejoin.persistedSuperReadOnlyBeforeCrash=true;
  });
  // Fence the former source before any test-only change to writable state.
  stage='source-fencing';
  await docker(['kill','--signal=KILL',sourceId],15000);
  report.promotion.primaryKilled=true;
  assert.equal(await docker(['inspect','--format','{{.State.Running}}',sourceId]),
    'false');
  report.promotion.primaryFencedAtPromotion=true;
  report.promotion.operatorApproved=true;
  const assessment=assessFencedPromotion({
    primaryFenced:report.promotion.primaryFencedAtPromotion,
    distinctServerIds:report.environment.distinctServerIds,
    gtidAutoPosition:report.replication.autoPosition,
    gtidApplied:report.replication.appliedGtidWaitResult===0,
    replicaReadOnly:report.replication.replicaReadOnlyBefore,
    committedTokenPresent:report.replication.originalTokenOnReplica===1,
    operatorApproved:process.env.NUBLOX_TEST_PROMOTION_APPROVAL==='1',
    noDivergentWrites:report.promotion.originalWriteExecutions===1
  });
  assert.equal(assessment.allowed,true);
  report.promotion.promotionDecision=assessment.decision;

  stage='test-promotion';
  await session(replica,async db=>{
    await db.query('STOP REPLICA');
    report.promotion.replicationStopped=true;
    await db.query('RESET REPLICA ALL');
    report.promotion.replicationConfigurationCleared=true;
    await db.query('SET GLOBAL super_read_only=OFF');
    await db.query('SET GLOBAL read_only=OFF');
    const r=(await db.query(
      'SELECT @@global.super_read_only AS sr, @@global.read_only AS ro'
    )).rows[0];
    assert.equal(Number(r.sr),0);assert.equal(Number(r.ro),0);
    report.promotion.replicaWritableAfterPromotion=true;
  });
  assert.equal(await docker(['inspect','--format','{{.State.Running}}',sourceId]),
    'false','The old primary must remain fenced before new writes');
  await session(inSchema(replica),async db=>{
    await db.transaction(async tx=>{
      await tx.query('INSERT INTO promoted_tokens (token,value) VALUES (?,?)',
        [secondToken,72]);
      report.promotion.promotedWriteExecutions++;
    });
    report.promotion.promotedWriteAcknowledged=true;
    const orig=(await db.query(
      'SELECT COUNT(*) AS n FROM promoted_tokens WHERE token=?',[firstToken]
    )).rows[0];
    const next=(await db.query(
      'SELECT COUNT(*) AS n FROM promoted_tokens WHERE token=?',[secondToken]
    )).rows[0];
    report.promotion.originalTokenCountAfterPromotion=Number(orig.n);
    report.promotion.promotedTokenCount=Number(next.n);
    assert.equal(orig.n,1n);assert.equal(next.n,1n);
  });
  report.promotion.oldPrimaryRemainedDown=
    await docker(['inspect','--format','{{.State.Running}}',sourceId])==='false';
  assert.equal(report.promotion.oldPrimaryRemainedDown,true);
  report.promotion.noAutomaticReplay=
    report.promotion.originalWriteExecutions===1&&
    report.promotion.promotedWriteExecutions===1;

  // Restore the original instance ONLY with its persisted read-only
  // configuration. Under no circumstances disable super_read_only here.
  stage='old-source-restart';
  await docker(['start',sourceId],30000);
  await until(async()=>await docker(['inspect','--format',
    '{{.State.Health.Status}}',sourceId],5000)==='healthy',
  90000,'Fenced former primary failed to restart');
  report.rejoin.restartHealthy=true;
  await session(source,async db=>{
    assert.equal(db.info.version,version);
    const vars=(await db.query(
      'SELECT @@GLOBAL.super_read_only AS sr, @@GLOBAL.read_only AS ro'
    )).rows[0];
    assert.equal(Number(vars.sr),1,'Former primary restarted as writable');
    assert.equal(Number(vars.ro),1,'Former primary read_only not set');
    report.rejoin.persistedSuperReadOnlyAfterRestart=true;
  });
  // An actual administrative connection must be unable to write, not just
  // a SELECT of flags. The preexisting table is authoritative; no replay.
  stage='old-source-write-rejection';
  await session(inSchema(source),async db=>{
    report.rejoin.oldPrimaryWriteAttempts++;
    await assert.rejects(
      db.query('INSERT INTO promoted_tokens (token,value) VALUES (?,?)',
        [rejectedToken,73]),
      error=>error?.code==='DATABASE_ERROR',
      'Old primary unexpectedly accepted a client write after restart'
    );
    report.rejoin.rejectedOldPrimaryWrite=true;
    const count=(await db.query(
      'SELECT COUNT(*) AS n FROM promoted_tokens WHERE token=?',
      [rejectedToken])).rows[0].n;
    assert.equal(count,0n);
    report.rejoin.noUnexpectedOldPrimaryWrites=true;
  });
  // Reconfigure the recovered old source as a REPLICA of the promoted node.
  // MySQL replication applier is authorised to apply GTIDs while ordinary
  // client writes are blocked by super_read_only.
  stage='reverse-replication-configuration';
  await session(source,async db=>{
    await db.query("CHANGE REPLICATION SOURCE TO "+
      "SOURCE_HOST='nublox-gtid-replica', SOURCE_PORT=3306, "+
      "SOURCE_USER='nublox_repl', "+
      "SOURCE_PASSWORD='fixture-repl-only', "+
      "SOURCE_AUTO_POSITION=1, GET_SOURCE_PUBLIC_KEY=1");
    await db.query('START REPLICA');
  });
  await until(async()=>session(source,async db=>{
    const status=(await db.query('SHOW REPLICA STATUS')).rows[0];
    return status?.Replica_IO_Running==='Yes'&&
      status?.Replica_SQL_Running==='Yes'&&
      Number(status?.Auto_Position)===1&&
      status?.Source_Host==='nublox-gtid-replica';
  }),30000,'Recovered former primary did not attach to promoted source');
  report.rejoin.receiverRunning=true;
  report.rejoin.applierRunning=true;
  report.rejoin.reverseAutoPosition=true;

  // Wait for the exact promoted source's GTID history, not merely
  // matching row counts or a healthy connection.
  stage='reverse-gtid-catchup';
  let promotedGTID;
  await session(replica,async db=>{
    const value=(await db.query('SELECT @@GLOBAL.gtid_executed AS gtid')).rows[0].gtid;
    assert.ok(typeof value==='string'&&value.length>0);
    promotedGTID=value;
  });
  await session(source,async db=>{
    const result=(await db.query(
      'SELECT WAIT_FOR_EXECUTED_GTID_SET(?, 20) AS caught_up',
      [promotedGTID])).rows[0];
    report.rejoin.reverseGtidCatchupResult=Number(result.caught_up);
    assert.equal(report.rejoin.reverseGtidCatchupResult,0,
      'Former primary never applied promoted source GTIDs');
    const vars=(await db.query(
      'SELECT @@GLOBAL.super_read_only AS sr, @@GLOBAL.read_only AS ro'
    )).rows[0];
    assert.equal(Number(vars.sr),1);assert.equal(Number(vars.ro),1);
    report.rejoin.superReadOnlyAfterCatchup=true;
    report.rejoin.oldPrimaryStillReadOnly=true;
  });
  await session(inSchema(source),async db=>{
    const old=(await db.query(
      'SELECT COUNT(*) AS n FROM promoted_tokens WHERE token=?',
      [firstToken])).rows[0].n;
    const promoted=(await db.query(
      'SELECT COUNT(*) AS n FROM promoted_tokens WHERE token=?',
      [secondToken])).rows[0].n;
    report.rejoin.originalTokenCount=Number(old);
    report.rejoin.promotedTokenCount=Number(promoted);
    assert.equal(old,1n);assert.equal(promoted,1n);
  });
  await session(replica,async db=>{
    const vars=(await db.query(
      'SELECT @@GLOBAL.super_read_only AS sr, @@GLOBAL.read_only AS ro'
    )).rows[0];
    assert.equal(Number(vars.sr),0);assert.equal(Number(vars.ro),0);
    report.rejoin.promotedPrimaryStillWritable=true;
  });
}catch(error){
  report.status='failed';
  report.failureStage=stage;
  report.failureCode=/^[A-Z_]{2,40}$/.test(error?.code??'')?
    error.code:'QUALIFICATION_FAILED';
  process.exitCode=1;
}finally{
  // Remove both disposable servers and their private network. Never
  // lift the recovered former primary's read-only fence in this test.
  try{
    for(const {id} of refs){
      await docker(['rm','-f',id],30000);
    }
    await docker(['network','rm',network],30000);
    report.cleanup.isolatedFixturesDisposed=true;
  }catch{
    report.status='failed';
    report.failureCode??='CLEANUP_FAILED';
    process.exitCode=1;
  }
  report.elapsedMs=Math.round((performance.now()-started)*1000)/1000;
  if(report.status==='running'){
    try{
      validateFormerPrimaryRejoinEvidence({...report,status:'passed'},{
        revision,runId,version
      });
      report.status='passed';
    }catch{
      report.status='failed';
      report.failureCode='EVIDENCE_INVALID';
      process.exitCode=1;
    }
  }
  const dir=resolve('artifacts/qualification');
  mkdirSync(dir,{recursive:true});
  const path=resolve(dir,'mysql-gtid-rejoin-'+runId+'.json');
  writeFileSync(path,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({
    status:report.status,report:path,
    replicaCaughtUp:report.replication.appliedGtidWaitResult===0,
    primaryFenced:report.promotion.primaryFencedAtPromotion,
    testPromotion:report.promotion.promotionDecision,
    promotedTokenCount:report.promotion.promotedTokenCount,
    rejoinedReadOnly:report.rejoin.oldPrimaryStillReadOnly,
    reverseGtidCaughtUp:report.rejoin.reverseGtidCatchupResult===0,
    fixturesDisposed:report.cleanup.isolatedFixturesDisposed,
    failureCode:report.failureCode,failureStage:report.failureStage??null
  }));
}
