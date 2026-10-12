'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const jobs = require('../lib/jobs/JobKernel');
const { createStore } = require('../lib/jobs/SqliteJobStore');
const { createWorker } = require('../lib/jobs/JobWorker');
const { createApprovalPolicy } = require('../lib/jobs/JobApprovalPolicy');

const T0 = Date.parse('2026-10-12T12:00:00Z');
const KIND = 'test.control.read';
const policy = createApprovalPolicy({ readOnlyKinds: [KIND] });

function plan(kind = KIND) {
  return jobs.createPlan({
    jobKind:kind, lifecyclePhase:'Understand', targetIdentity:'sqlite:test-control',
    policy:{readOnly:true,approvalRequired:false},steps:[{stepId:'first'}]
  });
}

async function withFile(fn, config = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'nublox-job-control-'));
  const filename=path.join(dir,'store.sqlite');
  let current=T0;
  const clock=()=>current;
  const configForStore=()=>({
    filename,clock,
    cancellationAuthorizer:config.cancellationAuthorizer || (()=>({allowed:true,actorId:'authenticated-operator'}))
  });
  let store=createStore(configForStore());
  const context={
    get store(){return store;}, clock,
    setTime(value){current=value;},
    reopen(){
      store.close();
      store=createStore(configForStore());
      return store;
    },filename
  };
  try{await fn(context);}
  finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
}

async function enqueue(store, definition, id) {
  const kernel=jobs.createKernel(store);
  await kernel.submit(definition,{runId:id});
  await kernel.advance(id,0,'queued');
}

function registryFor(executor) {
  const registry=jobs.createExecutorRegistry();
  registry.register(KIND,{retrySafe:true,resumeSafe:true,
    async execute(context){return executor.execute(context);},
    async verify(context){return executor.verify ? executor.verify(context) : true;}
  });
  return registry;
}

async function pendingCancellation() {
  await withFile(async ctx=>{
    const p=plan();
    await enqueue(ctx.store,p,'pending');
    const result=ctx.store.requestCancellation({
      runId:'pending',reason:'stop requested',actorId:'forged-identity'
    });
    assert.equal(result.status,'cancelled');
    assert.equal(ctx.store.getRun('pending').status,'cancelled');
    assert.equal(ctx.store.getCancellation('pending').actorId,'authenticated-operator');
    assert.equal(ctx.store.requestCancellation({runId:'pending',reason:'again'}).status,'cancelled');
    assert.deepEqual(ctx.store.listEvents('pending').map(x=>x.type),
      ['planned','status','cancellation-requested','status']);
    ctx.reopen();
    assert.equal(ctx.store.getCancellation('pending').reason,'stop requested');
    assert.equal(await jobs.createKernel(ctx.store).leaseNext(
      'worker',new Date(T0).toISOString(),new Date(T0+5000).toISOString()),null);
  });
  await withFile(async ctx=>{
    const p=plan();
    await jobs.createKernel(ctx.store).submit(p,{runId:'waiting'});
    await jobs.createKernel(ctx.store).advance('waiting',0,'awaiting-approval');
    assert.equal(ctx.store.requestCancellation({runId:'waiting',reason:'withdraw'}).status,'cancelled');
  });
  await withFile(async ctx=>{
    await enqueue(ctx.store,plan(),'denied');
    assert.throws(()=>ctx.store.requestCancellation({runId:'denied',reason:'test'}),/denied/);
    assert.equal(ctx.store.getCancellation('denied'),null);
    assert.equal(ctx.store.getRun('denied').status,'queued');
  },{cancellationAuthorizer:()=>({allowed:false,actorId:'other'})});
  await withFile(async ctx=>{
    await enqueue(ctx.store,plan(),'unauthorized');
    assert.throws(()=>ctx.store.requestCancellation({runId:'unauthorized',reason:'test'}),/not configured/);
  },{cancellationAuthorizer:undefined});
}

async function inFlightCancellation() {
  await withFile(async ctx=>{
    await enqueue(ctx.store,plan(),'inflight');
    let entered;
    const executing=new Promise(resolve=>{entered=resolve;});
    let seen=0;
    const registry=registryFor({
      async execute({signal}){
        seen++;
        entered();
        await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));
        return {safelyStopped:true};
      }
    });
    const worker=createWorker({
      store:ctx.store,registry,approvalPolicy:policy,workerId:'cancellation-worker',
      leaseMs:2000,heartbeatMs:25,clock:ctx.clock
    });
    const pending=worker.runOnce();
    await executing;
    assert.equal(ctx.store.getRun('inflight').status,'running');
    const request=ctx.store.requestCancellation({runId:'inflight',reason:'user stopped'});
    assert.equal(request.status,'running');
    assert.equal(request.requested,true);
    assert.equal(ctx.store.requestCancellation({runId:'inflight',reason:'duplicate'}).requested,true);
    const result=await pending;
    assert.equal(result.status,'cancelled');
    assert.equal(ctx.store.getRun('inflight').status,'cancelled');
    assert.equal(ctx.store.getRun('inflight').lease,undefined);
    assert.equal(seen,1);
    assert.equal((await worker.runOnce()),null);
  });
}

async function retrySuccessAndLimits() {
  await withFile(async ctx=>{
    const p=plan();
    await enqueue(ctx.store,p,'transient');
    let attempts=0;
    const registry=registryFor({
      async execute() {
        attempts++;
        if(attempts<3) throw Object.assign(new Error('transient private detail'),{retryable:true});
        return {attempts};
      }
    });
    const create=()=>createWorker({
      store:ctx.store,registry,approvalPolicy:policy,workerId:'retry-worker',
      clock:ctx.clock,maxReadOnlyAttempts:3,retryDelayMs:1000
    });
    assert.equal((await create().runOnce()).status,'retry-scheduled');
    assert.equal(ctx.store.getRun('transient').attempt,1);
    assert.equal(await create().runOnce(),null,'retry not due yet');
    assert.equal(attempts,1);
    ctx.reopen();
    ctx.setTime(T0+1001);
    assert.equal((await create().runOnce()).status,'retry-scheduled');
    assert.equal(ctx.store.getRun('transient').attempt,2);
    ctx.setTime(T0+2002);
    assert.equal((await create().runOnce()).status,'succeeded');
    assert.equal(attempts,3);
    assert.equal(ctx.store.getRun('transient').attempt,2);
    const events=ctx.store.listEvents('transient');
    assert.equal(events.filter(x=>x.type==='retry-scheduled').length,2);
    assert.equal(events.filter(x=>x.type==='retry-released').length,2);
    assert.ok(!JSON.stringify(events).includes('transient private detail'));
  });
  await withFile(async ctx=>{
    await enqueue(ctx.store,plan(),'exhausted');
    let calls=0;
    const registry=registryFor({
      async execute(){calls++;throw Object.assign(new Error('network'),{retryable:true});}
    });
    const worker=()=>createWorker({store:ctx.store,registry,approvalPolicy:policy,
      workerId:'exhausted-worker',clock:ctx.clock,maxReadOnlyAttempts:2,retryDelayMs:0});
    assert.equal((await worker().runOnce()).status,'retry-scheduled');
    assert.equal((await worker().runOnce()).status,'blocked');
    assert.equal(ctx.store.getRun('exhausted').reason,'read-only-retry-exhausted-or-unqualified');
    assert.equal(calls,2);
    assert.equal(await worker().runOnce(),null);
  });
  await withFile(async ctx=>{
    await enqueue(ctx.store,plan(),'ambiguous');
    const registry=registryFor({async execute(){throw new Error('ambiguous');}});
    const result=await createWorker({store:ctx.store,registry,approvalPolicy:policy,
      workerId:'ambiguous-worker',clock:ctx.clock}).runOnce();
    assert.equal(result.status,'blocked');
    assert.equal(ctx.store.getRun('ambiguous').attempt,0);
  });
}

async function interruptedRecovery() {
  await withFile(async ctx=>{
    await enqueue(ctx.store,plan(),'read-orphan');
    const kernel=jobs.createKernel(ctx.store);
    const leased=await kernel.leaseNext('dead-worker',
      new Date(T0).toISOString(),new Date(T0+1000).toISOString());
    await kernel.advance('read-orphan',leased.version,'running',{
      workerId:'dead-worker',fence:leased.lease.fence
    });
    ctx.setTime(T0+1100);
    assert.equal(ctx.store.recoverInterruptedReadOnly({
      approvalPolicy:policy,registry:registryFor({async execute(){return null;}}),
      maxAttempts:2,delayMs:0
    }).length,1);
    assert.equal(ctx.store.getRun('read-orphan').status,'retry-scheduled');
    const registry=registryFor({async execute(){return {resumed:true};}});
    const worker=createWorker({store:ctx.store,registry,approvalPolicy:policy,
      workerId:'recovery-worker',clock:ctx.clock});
    assert.equal((await worker.runOnce()).status,'succeeded');
    assert.equal(ctx.store.getRun('read-orphan').attempt,1);
    assert.ok(ctx.store.listEvents('read-orphan').some(x=>x.type==='recovered-read-only'));
  });
  await withFile(async ctx=>{
    await enqueue(ctx.store,plan(),'not-safe');
    const kernel=jobs.createKernel(ctx.store);
    const lease=await kernel.leaseNext('crashed',new Date(T0).toISOString(),new Date(T0+1000).toISOString());
    await kernel.advance('not-safe',lease.version,'running',{workerId:'crashed',fence:lease.lease.fence});
    ctx.setTime(T0+1100);
    const registry=jobs.createExecutorRegistry();
    registry.register(KIND,{retrySafe:true,resumeSafe:false,async execute(){},async verify(){return true;}});
    assert.equal(ctx.store.recoverInterruptedReadOnly({registry,approvalPolicy:policy}).length,0);
    assert.equal(ctx.store.getRun('not-safe').status,'running');
    assert.equal(ctx.store.recoverExpiredLeases({now:new Date(T0+1100).toISOString()}).orphaned.length,1);
  });
  await withFile(async ctx=>{
    await enqueue(ctx.store,plan(),'verify-orphan');
    const kernel=jobs.createKernel(ctx.store);
    const lease=await kernel.leaseNext('crashed',new Date(T0).toISOString(),new Date(T0+1000).toISOString());
    const running=await kernel.advance('verify-orphan',lease.version,'running',{workerId:'crashed',fence:lease.lease.fence});
    await kernel.advance('verify-orphan',running.version,'verifying',{workerId:'crashed',fence:lease.lease.fence});
    ctx.setTime(T0+1100);
    assert.equal(ctx.store.recoverInterruptedReadOnly({
      registry:registryFor({async execute(){}}),approvalPolicy:policy
    }).length,0);
    assert.equal(ctx.store.getRun('verify-orphan').status,'verifying');
  });
}

async function migrateV2Store() {
  await withFile(async ctx=>{
    await enqueue(ctx.store,plan(),'migrated');
    ctx.store.close();
    const db=new DatabaseSync(ctx.filename);
    db.exec('DROP TABLE job_cancellations; PRAGMA user_version = 2');
    db.close();
    // context.reopen() closes the old store harmlessly (idempotent).
    ctx.reopen();
    assert.equal(ctx.store.schemaVersion,3);
    assert.equal(ctx.store.getRun('migrated').status,'queued');
    assert.equal(ctx.store.getCancellation('migrated'),null);
  });
}

(async()=>{
  await pendingCancellation();
  await inFlightCancellation();
  await retrySuccessAndLimits();
  await interruptedRecovery();
  await migrateV2Store();
  console.log('NuBloxSQL cancellation, bounded retry and interrupted recovery: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
