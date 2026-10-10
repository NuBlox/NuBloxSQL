'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jobs = require('../lib/jobs/JobKernel');
const sqlite = require('../lib/jobs/SqliteJobStore');
const { createWorker } = require('../lib/jobs/JobWorker');

function plan(kind, approvalRequired = false) {
  return jobs.createPlan({
    jobKind: kind, lifecyclePhase: 'Understand', targetIdentity: 'sqlite:test',
    steps: [{stepId:'first'}, {stepId:'second'}],
    policy: { approvalRequired }
  });
}

async function withStore(test, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nublox-job-worker-'));
  const store = sqlite.createStore({ filename: path.join(directory, 'state.sqlite'), ...options });
  try { await test(store); }
  finally { store.close(); fs.rmSync(directory, { recursive:true, force:true }); }
}

async function enqueue(store, definition, runId) {
  const kernel = jobs.createKernel(store);
  await kernel.submit(definition, { runId });
  await kernel.advance(runId, 0, 'queued');
}

async function successfulExecution() {
  await withStore(async store => {
    const p = plan('test.worker.success');
    await enqueue(store, p, 'success');
    const registry = jobs.createExecutorRegistry();
    const calls = [];
    registry.register(p.jobKind, {
      async execute({step, plan: received, signal, checkpoint}) {
        assert.equal(received.planHash, p.planHash);
        assert.equal(signal.aborted, false);
        calls.push([step.stepId, checkpoint]);
        return { completed: step.stepId };
      },
      async verify({checkpoint}) {
        assert.equal(checkpoint.nextStepIndex, 2);
        return { verified:true };
      }
    });
    const worker = createWorker({ store, registry, workerId:'worker-success' });
    assert.deepEqual(await worker.runOnce(), { runId:'success', status:'succeeded' });
    assert.equal(store.getRun('success').status, 'succeeded');
    assert.equal(store.getRun('success').lease, undefined);
    assert.equal(store.getRun('success').checkpoint.lastCompletedStepId, 'second');
    assert.deepEqual(calls.map(c=>c[0]), ['first','second']);
    assert.equal(calls[0][1], null);
    assert.equal(calls[1][1].nextStepIndex, 1);
    assert.deepEqual(store.listEvents('success').map(e=>e.type),
      ['planned','status','leased','status','checkpoint','checkpoint','status','status']);
    assert.equal(await worker.runOnce(), null);
  });
}

async function incompleteAndUnapproved() {
  await withStore(async store => {
    const p = plan('test.worker.unregistered');
    await enqueue(store, p, 'unknown');
    const worker = createWorker({
      store, registry: jobs.createExecutorRegistry(), workerId: 'worker-unregistered'
    });
    assert.deepEqual(await worker.runOnce(), {runId:'unknown',status:'blocked'});
    assert.equal(store.getRun('unknown').reason,'qualified-executor-or-verifier-unavailable');

    const gated = plan('test.worker.gated', true);
    await enqueue(store, gated, 'unapproved');
    const registry = jobs.createExecutorRegistry();
    let called = false;
    registry.register(gated.jobKind, {
      async execute() { called=true; }, async verify() { return true; }
    });
    const second = createWorker({ store, registry, workerId:'worker-gated' });
    assert.deepEqual(await second.runOnce(), {runId:'unapproved',status:'blocked'});
    assert.equal(called, false);
    assert.equal(store.getRun('unapproved').reason,'approval-policy-not-qualified');
  });
}

async function ambiguousOutcomeDoesNotAutoRetry() {
  await withStore(async store => {
    const p = plan('test.worker.partial');
    await enqueue(store, p, 'ambiguous');
    const registry = jobs.createExecutorRegistry();
    let writes = 0;
    registry.register(p.jobKind, {
      async execute() { writes++; throw new Error('internal detail must not leak'); },
      async verify() { return true; }
    });
    const worker = createWorker({ store, registry, workerId:'worker-ambiguous' });
    assert.deepEqual(await worker.runOnce(), {runId:'ambiguous',status:'blocked'});
    assert.equal(writes,1);
    assert.equal(store.getRun('ambiguous').status,'blocked');
    assert.equal(store.getRun('ambiguous').lease, undefined);
    assert.ok(!JSON.stringify(store.listEvents('ambiguous')).includes('internal detail'));
    assert.equal(await worker.runOnce(),null);
    assert.equal(writes,1);
  });

  await withStore(async store => {
    const p=plan('test.worker.unverified');
    await enqueue(store,p,'unverified');
    const registry=jobs.createExecutorRegistry();
    registry.register(p.jobKind,{
      async execute(){return {completed:true};},
      async verify(){return false;}
    });
    const worker=createWorker({store,registry,workerId:'worker-unverified'});
    assert.deepEqual(await worker.runOnce(),{runId:'unverified',status:'blocked'});
    assert.equal(store.getRun('unverified').reason,'post-execution-verification-unconfirmed');
  });
}

async function heartbeatAndLoss() {
  await withStore(async store => {
    const p=plan('test.worker.heartbeat');
    await enqueue(store,p,'heartbeat');
    const registry=jobs.createExecutorRegistry();
    registry.register(p.jobKind,{
      async execute({signal}){
        await new Promise(resolve=>setTimeout(resolve,125));
        assert.equal(signal.aborted,false);
        return {done:true};
      },
      async verify(){return true;}
    });
    const worker=createWorker({store,registry,workerId:'worker-heartbeat',leaseMs:2000,heartbeatMs:40});
    assert.equal((await worker.runOnce()).status,'succeeded');
    assert.equal(store.getRun('heartbeat').status,'succeeded');
    assert.ok(store.listEvents('heartbeat').filter(e=>e.type==='lease-renewed').length>=1);
  });

  let clock=Date.parse('2026-10-10T08:00:00.000Z');
  await withStore(async store => {
    const p=plan('test.worker.expiry');
    await enqueue(store,p,'expired');
    const registry=jobs.createExecutorRegistry();
    registry.register(p.jobKind,{
      async execute(){clock+=1000;return {done:true};},
      async verify(){return true;}
    });
    const worker=createWorker({
      store,registry,workerId:'worker-expiry',leaseMs:120,heartbeatMs:20,
      clock:()=>clock
    });
    assert.deepEqual(await worker.runOnce(),{runId:'expired',status:'orphaned',reason:'state-or-lease-conflict'});
    const persisted=store.getRun('expired');
    assert.equal(persisted.status,'running');
    assert.equal(store.recoverExpiredLeases({now:new Date(clock).toISOString()}).orphaned.length,1);
  },{clock:()=>clock});
}

async function concurrentClaims() {
  await withStore(async store => {
    const p=plan('test.worker.concurrent');
    await enqueue(store,p,'one');
    await enqueue(store,p,'two');
    const registry=jobs.createExecutorRegistry();
    const completed=[];
    registry.register(p.jobKind,{
      async execute({runId,step}) {completed.push(runId+':'+step.stepId); await Promise.resolve(); return null;},
      async verify(){return true;}
    });
    const a=createWorker({store,registry,workerId:'worker-a'});
    const b=createWorker({store,registry,workerId:'worker-b'});
    const outcomes=await Promise.all([a.runOnce(),b.runOnce()]);
    assert.deepEqual(outcomes.map(o=>o.runId).sort(),['one','two']);
    assert.ok(outcomes.every(o=>o.status==='succeeded'));
    assert.equal(completed.length,4);
  });
}

async function validateInputs() {
  assert.throws(()=>createWorker({workerId:'',store:{},registry:{}}),/workerId/);
  assert.throws(()=>createWorker({workerId:'id',store:{},registry:{}}),/JobStore/);
  assert.throws(()=>createWorker({workerId:'id',store:{getPlan(){},renewLease(){}},registry:{resolve(){return null;}},leaseMs:100,heartbeatMs:70}),/heartbeatMs/);
}

(async () => {
  await successfulExecution();
  await incompleteAndUnapproved();
  await ambiguousOutcomeDoesNotAutoRetry();
  await heartbeatAndLoss();
  await concurrentClaims();
  await validateInputs();
  console.log('NuBloxSQL durable job worker contract: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
