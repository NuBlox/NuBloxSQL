'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const childProcess=require('node:child_process');
const jobs=require('../lib/jobs/JobKernel');
const sqliteStore=require('../lib/jobs/SqliteJobStore');

function fixturePlan(){
  return jobs.createPlan({
    jobKind:'lifecycle.install',
    lifecyclePhase:'Install',
    targetIdentity:'local-host:test',
    steps:[{stepId:'inspect'},{stepId:'install'},{stepId:'verify'}],
    policy:{approvalRequired:true}
  });
}

function tempDatabase(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nublox-job-store-'));
  return {dir:dir,filename:path.join(dir,'jobs.sqlite')};
}

function cleanup(temp){
  fs.rmSync(temp.dir,{recursive:true,force:true});
}

function spawnLease(filename,workerId,now,expiresAt){
  return new Promise(function(resolve,reject){
    const file=path.join(__dirname,'fixtures','job-store-lease-worker.js');
    const child=childProcess.spawn(process.execPath,[file,filename,workerId,now,expiresAt],{
      stdio:['ignore','pipe','pipe']
    });
    let stdout='',stderr='';
    child.stdout.on('data',function(chunk){stdout+=chunk;});
    child.stderr.on('data',function(chunk){stderr+=chunk;});
    child.on('error',reject);
    child.on('close',function(code){
      if(code!==0)return reject(new Error('lease worker '+workerId+' failed: '+stderr));
      try{resolve(JSON.parse(stdout||'null'));}catch(error){reject(new Error('invalid lease worker output: '+stdout+'\n'+stderr+'\n'+error.message));}
    });
  });
}

async function durabilityAndAtomicEvents(){
  const temp=tempDatabase();
  const plan=fixturePlan();
  try{
    let store=sqliteStore.createStore({filename:temp.filename});
    const kernel=jobs.createKernel(store);
    const submitted=await kernel.submit(plan,{runId:'run-durable',now:'2026-10-09T20:00:00.000Z'});
    assert.equal(submitted.status,'planned');
    assert.equal(store.listEvents('run-durable').length,1);

    const queued=await kernel.advance('run-durable',0,'queued',{now:'2026-10-09T20:00:01.000Z'});
    assert.equal(queued.status,'queued');
    assert.equal(store.listEvents('run-durable').length,2);
    store.close();

    store=sqliteStore.createStore({filename:temp.filename});
    assert.deepEqual(store.getPlan(plan.planHash),plan);
    const reopened=store.getRun('run-durable');
    assert.equal(reopened.status,'queued');
    assert.equal(reopened.version,1);
    assert.deepEqual(store.listEvents('run-durable').map(function(event){return event.type;}),['planned','status']);

    const kernel2=jobs.createKernel(store);
    await assert.rejects(
      kernel2.advance('run-durable',0,'cancelled',{now:'2026-10-09T20:00:02.000Z'}),
      /version conflict/
    );
    assert.equal(store.listEvents('run-durable').length,2);

    await assert.rejects(
      kernel2.submit(plan,{runId:'run-durable',now:'2026-10-09T20:00:03.000Z'}),
      /UNIQUE constraint failed|duplicate/i
    );
    assert.equal(store.listEvents('run-durable').length,2);
    store.close();
  }finally{
    cleanup(temp);
  }
}

async function multiProcessLeaseAndRecovery(){
  const temp=tempDatabase();
  const plan=fixturePlan();
  try{
    let store=sqliteStore.createStore({filename:temp.filename,busyTimeout:10000});
    const kernel=jobs.createKernel(store);
    await kernel.submit(plan,{runId:'run-lease',now:'2026-10-09T20:10:00.000Z'});
    await kernel.advance('run-lease',0,'queued',{now:'2026-10-09T20:10:01.000Z'});
    store.close();

    const now='2026-10-09T20:10:02.000Z';
    const expires='2026-10-09T20:11:02.000Z';
    const results=await Promise.all([
      spawnLease(temp.filename,'worker-a',now,expires),
      spawnLease(temp.filename,'worker-b',now,expires)
    ]);
    const claimed=results.filter(Boolean);
    assert.equal(claimed.length,1);
    assert.equal(claimed[0].status,'leased');
    assert.equal(claimed[0].lease.fence,1);
    assert.ok(['worker-a','worker-b'].includes(claimed[0].lease.workerId));

    store=sqliteStore.createStore({filename:temp.filename,busyTimeout:10000});
    assert.equal(await store.leaseNextRun({
      workerId:'worker-c',
      now:'2026-10-09T20:10:30.000Z',
      expiresAt:'2026-10-09T20:11:30.000Z'
    }),null);

    const recovery=await store.recoverExpiredLeases({now:'2026-10-09T20:11:03.000Z'});
    assert.equal(recovery.requeued.length,1);
    assert.equal(recovery.orphaned.length,0);
    assert.equal(recovery.requeued[0].status,'queued');
    assert.equal(recovery.requeued[0].version,3);

    const second=await store.leaseNextRun({
      workerId:'worker-c',
      now:'2026-10-09T20:11:04.000Z',
      expiresAt:'2026-10-09T20:12:04.000Z'
    });
    assert.equal(second.status,'leased');
    assert.equal(second.lease.workerId,'worker-c');
    assert.equal(second.lease.fence,2);
    assert.equal(second.version,4);

    assert.deepEqual(
      store.listEvents('run-lease').map(function(event){return event.type;}),
      ['planned','status','leased','lease-expired','leased']
    );
    store.close();
  }finally{
    cleanup(temp);
  }
}

async function activeLeaseExpiryIsNotBlindlyReplayed(){
  const temp=tempDatabase();
  const plan=fixturePlan();
  let clock=Date.parse('2026-10-09T21:00:00.000Z');
  try{
    const store=sqliteStore.createStore({filename:temp.filename,clock:function(){return clock;}});
    const kernel=jobs.createKernel(store);
    await kernel.submit(plan,{runId:'run-active',now:'2026-10-09T21:00:00.000Z'});
    await kernel.advance('run-active',0,'queued',{now:'2026-10-09T21:00:01.000Z'});
    const leased=await kernel.leaseNext('worker-a','2026-10-09T21:00:02.000Z','2026-10-09T21:01:02.000Z');
    const running=await kernel.advance('run-active',leased.version,'running',{
      workerId:'worker-a',fence:leased.lease.fence,now:'2026-10-09T21:00:03.000Z'
    });
    assert.equal(running.status,'running');

    const renewed=await store.renewLease({
      runId:'run-active',
      workerId:'worker-a',
      fence:running.lease.fence,
      expectedVersion:running.version,
      now:'2026-10-09T21:00:30.000Z',
      expiresAt:'2026-10-09T21:02:30.000Z'
    });
    assert.equal(renewed.lease.expiresAt,'2026-10-09T21:02:30.000Z');

    const checkpointed=await kernel.checkpoint('run-active',renewed.version,{stepId:'inspect'},{
      workerId:'worker-a',
      fence:renewed.lease.fence,
      now:'2026-10-09T21:00:31.000Z'
    });
    assert.equal(checkpointed.updatedAt,'2026-10-09T21:00:31.000Z');

    clock=Date.parse('2026-10-09T21:02:31.000Z');
    const recovery=await store.recoverExpiredLeases({now:'2026-10-09T21:02:31.000Z'});
    assert.equal(recovery.requeued.length,0);
    assert.equal(recovery.orphaned.length,1);
    assert.equal(recovery.orphaned[0].runId,'run-active');
    assert.equal(recovery.orphaned[0].status,'running');
    assert.equal(await store.leaseNextRun({
      workerId:'worker-b',
      now:'2026-10-09T21:02:32.000Z',
      expiresAt:'2026-10-09T21:03:32.000Z'
    }),null);

    await assert.rejects(
      kernel.checkpoint('run-active',checkpointed.version,{stepId:'install'},{
        workerId:'worker-a',
        fence:checkpointed.lease.fence,
        now:'2026-10-09T21:02:32.000Z'
      }),
      /lease has expired/
    );

    await assert.rejects(
      kernel.advance('run-active',checkpointed.version,'verifying',{
        workerId:'worker-a',
        fence:checkpointed.lease.fence,
        now:'2026-10-09T21:02:32.000Z'
      }),
      /lease has expired/
    );

    // A forged historical updatedAt must not override the store's authoritative clock.
    await assert.rejects(
      kernel.advance('run-active',checkpointed.version,'verifying',{
        workerId:'worker-a',
        fence:checkpointed.lease.fence,
        now:'2026-10-09T21:00:05.000Z'
      }),
      /lease has expired/
    );

    await assert.rejects(
      Promise.resolve().then(function(){
        return store.renewLease({
          runId:'run-active', workerId:'worker-a', fence:checkpointed.lease.fence,
          expectedVersion:checkpointed.version,
          now:'2026-10-09T21:00:05.000Z', expiresAt:'2026-10-09T21:04:00.000Z'
        });
      }),
      /already expired/
    );
    store.close();
  }finally{
    cleanup(temp);
  }
}

async function leaseReleasePreservesFenceMonotonicity(){
  const temp=tempDatabase();
  const plan=fixturePlan();
  try{
    const store=sqliteStore.createStore({filename:temp.filename,clock:function(){return Date.parse('2026-10-09T22:00:10.000Z');}});
    const kernel=jobs.createKernel(store);
    await kernel.submit(plan,{runId:'run-release',now:'2026-10-09T22:00:00.000Z'});
    await kernel.advance('run-release',0,'queued',{now:'2026-10-09T22:00:01.000Z'});
    const leased=await kernel.leaseNext('worker-a','2026-10-09T22:00:02.000Z','2026-10-09T22:01:02.000Z');
    const running=await kernel.advance('run-release',leased.version,'running',{
      workerId:'worker-a',fence:leased.lease.fence,now:'2026-10-09T22:00:03.000Z'
    });
    const waiting=await kernel.advance('run-release',running.version,'waiting',{
      workerId:'worker-a',fence:running.lease.fence,now:'2026-10-09T22:00:04.000Z'
    });
    assert.equal(waiting.lease,undefined);

    const queued=await kernel.advance('run-release',waiting.version,'queued',{now:'2026-10-09T22:00:05.000Z'});
    const leasedAgain=await kernel.leaseNext('worker-b','2026-10-09T22:00:06.000Z','2026-10-09T22:01:06.000Z');
    assert.equal(leasedAgain.runId,queued.runId);
    assert.equal(leasedAgain.lease.fence,2);
    store.close();
  }finally{
    cleanup(temp);
  }
}

async function invalidAndClosedStore(){
  const temp=tempDatabase();
  try{
    assert.throws(function(){
      sqliteStore.createStore({filename:':memory:'});
    },/file-backed/);

    const store=sqliteStore.createStore({filename:temp.filename});
    assert.equal(store.schemaVersion,1);
    assert.equal(store.kind,'sqlite-local');
    assert.equal(store.distributed,false);
    assert.equal(path.resolve(temp.filename),store.filename);
    store.close();
    assert.throws(function(){store.getRun('x');},/closed/);
  }finally{
    cleanup(temp);
  }
}

Promise.resolve()
  .then(durabilityAndAtomicEvents)
  .then(multiProcessLeaseAndRecovery)
  .then(activeLeaseExpiryIsNotBlindlyReplayed)
  .then(leaseReleasePreservesFenceMonotonicity)
  .then(invalidAndClosedStore)
  .then(function(){console.log('NuBloxSQL durable SQLite JobStore contract: PASS');})
  .catch(function(error){console.error(error);process.exitCode=1;});
