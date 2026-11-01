#!/usr/bin/env node
/**
 * ISOLATED CI-ONLY GTID network partition and blocked-promotion qualification
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
import {validateAsymmetricFencingEvidence,assessAsymmetricPromotion}
  from './asymmetric-fencing-evidence.mjs';

const exec=promisify(execFile),started=performance.now();
const revision=process.env.GITHUB_SHA,runId=process.env.GITHUB_RUN_ID;
const sourceId=process.env.NUBLOX_GTID_SOURCE_CONTAINER;
const replicaId=process.env.NUBLOX_GTID_REPLICA_CONTAINER;
const network=process.env.NUBLOX_GTID_NETWORK;
const observerSourceNet='nublox-observer-source-'+runId;
const observerReplicaNet='nublox-observer-replica-'+runId;
const version='8.4.13';
if(process.env.CI!=='true'||process.env.NUBLOX_LIVE_MYSQL!=='1'||
   process.env.NUBLOX_ALLOW_DESTRUCTIVE_MYSQL_FIXTURE!=='1'||
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
const firstToken=randomUUID(),secondToken=randomUUID(),rejectedToken=randomUUID(),fenceToken=randomUUID();
const report={
  schemaVersion:1,kind:'mysql-asymmetric-fencing',
  status:'running',failureCode:null,revision,runId,
  environment:{
    ci:true,node:process.version,platform:platform(),arch:arch(),
    transport:'isolated-local',sourceImage:'mysql:'+version,
    replicaImage:'mysql:'+version,sourceVersion:null,replicaVersion:null,
    distinctServerIds:false
  },
  replication:{
    gtidModeOnBoth:false,autoPosition:false,
    replicaReadOnlyBefore:false,sourceCommitAcknowledged:false,
    appliedGtidWaitResult:null,originalTokenOnReplica:null,
    replicationReceiverRunning:false,replicationApplierRunning:false
  },
  baseline:null,
  observers:{independentObserverNetworks:false,
    sourceObserverCanReachSource:false,sourceObserverCannotReachReplica:false,
    replicaObserverCanReachReplica:false,replicaObserverCannotReachSource:false,
    reachabilityViewsConflict:false},
  fencing:{adminWriteFencePersisted:false,sourceClientWriteRejected:false,
    writeFenceVerified:false,hardKillVerified:false,
    replicaStillLaggingAfterKill:false,
    promotionBlockedEvenWhenSourceDead:false,sourceRestartedHealthy:false,
    persistedFenceAfterRestart:false,sourceRestartWriteRejected:false,
    noOriginalWriteReplay:false},
  partition:{replicationNetworkDisconnected:false,sourceReachable:false,
    replicaReachable:false,sourceWritable:false,replicaSuperReadOnly:false,
    primaryWriteExecutions:0,standbyWriteExecutions:0,
    standbyClientWriteRejected:false,replicaMissingNewToken:false,
    gtidWaitTimedOut:null,sourceNotFenced:false,promotionAttempts:0,
    promotionDecision:'blocked',replayExecutions:0},
  healing:{replicationNetworkReconnected:false,receiverRunning:false,
    applierRunning:false,catchupResult:null,originalTokenCount:null,
    partitionTokenCount:null,replicaStillSuperReadOnly:false,
    sourceStillWritable:false,sourceStillSuperReadOnly:false,
    simultaneouslyWritableSources:null},
  cleanup:{isolatedFixturesDisposed:false,observerNetworksDisposed:false},elapsedMs:null
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
    report.environment.sourceVersion=db.info.version;
    const r=(await db.query(
      'SELECT @@server_uuid AS uuid, @@server_id AS sid, @@gtid_mode AS gtid, @@log_bin AS bin'
    )).rows[0];
    sourceUUID=r.uuid;sourceServerId=Number(r.sid);
    assert.equal(r.gtid,'ON');assert.equal(Number(r.bin),1);
    await db.query(
      "CREATE USER 'nublox_repl'@'%' IDENTIFIED BY 'fixture-repl-only'");
    await db.query(
      "GRANT REPLICATION SLAVE ON *.* TO 'nublox_repl'@'%'");
    // Source-created read-only observer user replicates to the standby
    // before its super_read_only setting is enabled.
    await db.query(
      "CREATE USER 'nublox_probe'@'%' IDENTIFIED BY 'fixture-probe-only'");
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


  report.baseline={gtidModeBoth:report.replication.gtidModeOnBoth,
    replicationAutoPosition:report.replication.autoPosition,
    initialCatchupResult:report.replication.appliedGtidWaitResult,
    initialTokenOnReplica:report.replication.originalTokenOnReplica,
    replicaSuperReadOnly:report.replication.replicaReadOnlyBefore};

  // Both hosts remain independently reachable over Docker's default bridge.
  // Only the secondary private replication interface is disconnected.
  stage='isolate-private-replication-network';
  await docker(['network','disconnect','-f',network,replicaId]);
  report.partition.replicationNetworkDisconnected=true;
  await session(source,async db=>{
    assert.equal(Number((await db.query(
      'SELECT @@GLOBAL.read_only AS ro')).rows[0].ro),0);
    report.partition.sourceReachable=true;
    report.partition.sourceWritable=true;
  });
  await session(replica,async db=>{
    const r=(await db.query(
      'SELECT @@GLOBAL.super_read_only AS sr, @@GLOBAL.read_only AS ro'
    )).rows[0];
    assert.equal(Number(r.sr),1);assert.equal(Number(r.ro),1);
    report.partition.replicaReachable=true;
    report.partition.replicaSuperReadOnly=true;
  });


  // Two independently network-scoped observers see opposite MySQL hosts.
  // This is genuine Docker bridge separation, not a simulated boolean.
  stage='independent-observer-network-probes';
  const scopedIP=async(id,net)=>{
    const address=await docker(['inspect','--format',
      '{{with index .NetworkSettings.Networks "'+net+'"}}{{.IPAddress}}{{end}}',
      id]);
    assert.match(address,/^[0-9]{1,3}(\.[0-9]{1,3}){3}$/);
    return address;
  };
  const sourceIP=await scopedIP(sourceId,observerSourceNet);
  const replicaIP=await scopedIP(replicaId,observerReplicaNet);
  const probe=async(net,address)=>docker([
    'run','--rm','--network',net,'-e','MYSQL_PWD=fixture-probe-only',
    '--entrypoint','mysql','mysql:8.4.13',
    '--protocol=tcp','--connect-timeout=2',
    '-u','nublox_probe','-h',address,'-N','-B','-e','SELECT 1'
  ],15000);
  assert.equal(await probe(observerSourceNet,sourceIP),'1');
  report.observers.sourceObserverCanReachSource=true;
  assert.equal(await probe(observerReplicaNet,replicaIP),'1');
  report.observers.replicaObserverCanReachReplica=true;
  let canCross=false;
  try{canCross=(await probe(observerSourceNet,replicaIP))==='1';}catch{}
  assert.equal(canCross,false,'Source-view observer could reach replica');
  report.observers.sourceObserverCannotReachReplica=true;
  canCross=false;
  try{canCross=(await probe(observerReplicaNet,sourceIP))==='1';}catch{}
  assert.equal(canCross,false,'Replica-view observer could reach source');
  report.observers.replicaObserverCannotReachSource=true;
  report.observers.independentObserverNetworks=true;
  report.observers.reachabilityViewsConflict=true;

  stage='commit-during-partition';
  let partitionGtid;
  await session(inSchema(source),async db=>{
    await db.transaction(async tx=>{
      await tx.query('INSERT INTO promoted_tokens (token,value) VALUES (?,?)',
        [secondToken,72]);
      report.partition.primaryWriteExecutions++;
    });
    partitionGtid=(await db.query(
      'SELECT @@GLOBAL.gtid_executed AS gtid')).rows[0].gtid;
    assert.ok(partitionGtid&&typeof partitionGtid==='string');
  });
  stage='verify-stale-replica';
  await session(inSchema(replica),async db=>{
    const count=(await db.query(
      'SELECT COUNT(*) AS n FROM promoted_tokens WHERE token=?',
      [secondToken])).rows[0].n;
    assert.equal(count,0n);
    report.partition.replicaMissingNewToken=true;
    const wait=(await db.query(
      'SELECT WAIT_FOR_EXECUTED_GTID_SET(?, 2) AS caught_up',
      [partitionGtid])).rows[0];
    report.partition.gtidWaitTimedOut=Number(wait.caught_up);
    assert.equal(report.partition.gtidWaitTimedOut,1);
    await assert.rejects(db.query(
      'INSERT INTO promoted_tokens (token,value) VALUES (?,?)',
      [rejectedToken,73]),e=>e?.code==='DATABASE_ERROR');
    const absent=(await db.query(
      'SELECT COUNT(*) AS n FROM promoted_tokens WHERE token=?',
      [rejectedToken])).rows[0].n;
    assert.equal(absent,0n);
    report.partition.standbyClientWriteRejected=true;
  });
  stage='block-partition-promotion';
  report.partition.sourceNotFenced=true;
  const decision=assessAsymmetricPromotion({
    sourceHardFenced:false,gtidCaughtUp:false,
    observerViewsAgree:false,operatorApproved:false,replicaReadOnly:true});
  assert.equal(decision.decision,'blocked');
  assert.equal(decision.canPromote,false);
  assert.equal(decision.canReplay,false);
  assert.ok(decision.blocking.includes('source-not-hard-fenced'));
  assert.ok(decision.blocking.includes('source-gtid-missing'));
  report.partition.promotionDecision=decision.decision;


  // An actual administrative write fence is persisted before killing the
  // source. The replica is stale; killing the source cannot make it current.
  stage='persist-source-write-fence';
  await session(source,async db=>{
    await db.query('SET PERSIST super_read_only=ON');
    const vars=(await db.query(
      'SELECT @@GLOBAL.super_read_only AS sr, @@GLOBAL.read_only AS ro'
    )).rows[0];
    assert.equal(Number(vars.sr),1);
    assert.equal(Number(vars.ro),1);
    report.fencing.writeFenceVerified=true;
    report.fencing.adminWriteFencePersisted=true;
  });
  await session(inSchema(source),async db=>{
    await assert.rejects(db.query(
      'INSERT INTO promoted_tokens (token,value) VALUES (?,?)',
      [fenceToken,74]),e=>e?.code==='DATABASE_ERROR');
    const absent=(await db.query(
      'SELECT COUNT(*) AS n FROM promoted_tokens WHERE token=?',
      [fenceToken])).rows[0].n;
    assert.equal(absent,0n);
    report.fencing.sourceClientWriteRejected=true;
  });
  stage='docker-hard-kill-source';
  await docker(['kill','--signal=KILL',sourceId],15000);
  assert.equal(await docker(['inspect','--format','{{.State.Running}}',sourceId]),
    'false');
  report.fencing.hardKillVerified=true;
  stage='fenced-source-but-stale-replica';
  await session(replica,async db=>{
    const wait=(await db.query(
      'SELECT WAIT_FOR_EXECUTED_GTID_SET(?, 1) AS waited',
      [partitionGtid])).rows[0];
    assert.equal(Number(wait.waited),1,
      'Replica unexpectedly caught up after source was hard fenced');
    report.fencing.replicaStillLaggingAfterKill=true;
  });
  const fencedDecision=assessAsymmetricPromotion({
    sourceHardFenced:true,gtidCaughtUp:false,
    observerViewsAgree:false,operatorApproved:true,replicaReadOnly:true
  });
  assert.equal(fencedDecision.decision,'blocked');
  assert.ok(fencedDecision.blocking.includes('source-gtid-missing'));
  report.fencing.promotionBlockedEvenWhenSourceDead=true;

  // Restart only with persisted read-only enforcement, and explicitly
  // demonstrate that normal SQL cannot commit to the old writer.
  stage='restart-source-with-persisted-fence';
  await docker(['start',sourceId],30000);
  await until(async()=>{
    const health=await docker(['inspect','--format','{{.State.Health.Status}}',
      sourceId],5000);
    return health==='healthy';
  },90000,'Fenced source failed to restart read-only');
  report.fencing.sourceRestartedHealthy=true;
  await session(source,async db=>{
    const vars=(await db.query(
      'SELECT @@GLOBAL.super_read_only AS sr, @@GLOBAL.read_only AS ro'
    )).rows[0];
    assert.equal(Number(vars.sr),1);
    assert.equal(Number(vars.ro),1);
    report.fencing.persistedFenceAfterRestart=true;
  });
  await session(inSchema(source),async db=>{
    await assert.rejects(db.query(
      'INSERT INTO promoted_tokens (token,value) VALUES (?,?)',
      [fenceToken,74]),e=>e?.code==='DATABASE_ERROR');
    report.fencing.sourceRestartWriteRejected=true;
  });
  report.fencing.noOriginalWriteReplay=
    report.partition.primaryWriteExecutions===1&&
    report.partition.replayExecutions===0;

  stage='restore-replication-network';
  await docker(['network','connect','--alias','nublox-gtid-replica',
    network,replicaId]);
  report.healing.replicationNetworkReconnected=true;
  await session(replica,async db=>{
    await db.query('STOP REPLICA IO_THREAD');
    await db.query('START REPLICA IO_THREAD');
  });
  await until(()=>session(replica,async db=>{
    const s=(await db.query('SHOW REPLICA STATUS')).rows[0];
    return s?.Replica_IO_Running==='Yes'&&
      s?.Replica_SQL_Running==='Yes'&&Number(s?.Auto_Position)===1;
  }),45000,'Replication did not resume after healing');
  report.healing.receiverRunning=true;
  report.healing.applierRunning=true;
  stage='post-partition-gtid';
  await session(replica,async db=>{
    const wait=(await db.query(
      'SELECT WAIT_FOR_EXECUTED_GTID_SET(?, 30) AS caught_up',
      [partitionGtid])).rows[0];
    report.healing.catchupResult=Number(wait.caught_up);
    assert.equal(report.healing.catchupResult,0);
    const v=(await db.query(
      'SELECT @@GLOBAL.super_read_only AS sr, @@GLOBAL.read_only AS ro'
    )).rows[0];
    assert.equal(Number(v.sr),1);assert.equal(Number(v.ro),1);
    report.healing.replicaStillSuperReadOnly=true;
  });
  await session(inSchema(replica),async db=>{
    const first=(await db.query(
      'SELECT COUNT(*) AS n FROM promoted_tokens WHERE token=?',
      [firstToken])).rows[0].n;
    const second=(await db.query(
      'SELECT COUNT(*) AS n FROM promoted_tokens WHERE token=?',
      [secondToken])).rows[0].n;
    assert.equal(first,1n);assert.equal(second,1n);
    report.healing.originalTokenCount=1;
    report.healing.partitionTokenCount=1;
  });
  await session(source,async db=>{
    const v=(await db.query(
      'SELECT @@GLOBAL.super_read_only AS sr, @@GLOBAL.read_only AS ro'
    )).rows[0];
    assert.equal(Number(v.sr),1);assert.equal(Number(v.ro),1);
    report.healing.sourceStillSuperReadOnly=true;
    report.healing.simultaneouslyWritableSources=0;
  });
}catch(error){
  report.status='failed';
  report.failureStage=stage;
  report.failureCode=/^[A-Z_]{2,40}$/.test(error?.code??'')?
    error.code:'QUALIFICATION_FAILED';
  process.exitCode=1;
}finally{
  // Dispose both isolated fixtures. Neither was promoted in this test;
  // no production network, server or application data is touched.
  try{
    for(const {id} of refs){
      await docker(['rm','-f',id],30000);
    }
    await docker(['network','rm',network],30000);
    report.cleanup.isolatedFixturesDisposed=true;
    await docker(['network','rm',observerSourceNet],30000);
    await docker(['network','rm',observerReplicaNet],30000);
    report.cleanup.observerNetworksDisposed=true;
  }catch{
    report.status='failed';
    report.failureCode??='CLEANUP_FAILED';
    process.exitCode=1;
  }
  report.elapsedMs=Math.round((performance.now()-started)*1000)/1000;
  if(report.status==='running'){
    try{
      validateAsymmetricFencingEvidence({...report,status:'passed'},{
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
  const path=resolve(dir,'mysql-asymmetric-fencing-'+runId+'.json');
  writeFileSync(path,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({
    status:report.status,report:path,
    observerViewsConflict:report.observers.reachabilityViewsConflict,
    hardFenceVerified:report.fencing.hardKillVerified,
    sourceRestartedReadOnly:report.fencing.persistedFenceAfterRestart,
    partitionObserved:report.partition.replicationNetworkDisconnected,
    gtidLagObserved:report.partition.gtidWaitTimedOut===1,
    unsafePromotionBlocked:report.partition.promotionDecision==='blocked',
    gtidCaughtUpAfterHealing:report.healing.catchupResult===0,
    fixturesDisposed:report.cleanup.isolatedFixturesDisposed,
    failureCode:report.failureCode,failureStage:report.failureStage??null
  }));
}
