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

const KIND = 'administration.test-change';
const NOW = Date.parse('2026-10-11T10:00:00.000Z');

function mutablePlan() {
  return jobs.createPlan({
    jobKind: KIND, lifecyclePhase: 'Establish', targetIdentity: 'mysql:primary',
    policy: { approvalRequired: true, readOnly: false },
    steps: [{ stepId: 'change' }]
  });
}

function request(runId, plan, overrides = {}) {
  return {
    runId, planHash: plan.planHash, jobKind: plan.jobKind,
    targetIdentity: plan.targetIdentity,
    reason: 'ticket CHG-123', expiresAt: new Date(NOW + 300000).toISOString(),
    ...overrides
  };
}

async function withDirectory(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nublox-approval-policy-'));
  try { await fn(path.join(dir, 'jobs.sqlite')); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

async function submitForApproval(store, plan, runId) {
  const kernel = jobs.createKernel(store);
  await kernel.submit(plan, { runId, requestedBy: 'engineer' });
  await kernel.advance(runId, 0, 'awaiting-approval');
}

function qualifiedRegistry(overrides = {}) {
  const registry = jobs.createExecutorRegistry();
  const state = { writes: 0, reconciliations: 0 };
  registry.register(KIND, {
    targetSideFencing: true,
    async reconcile() {
      state.reconciliations++;
      return overrides.reconcile ? overrides.reconcile() : true;
    },
    async execute() { state.writes++; return { done: true }; },
    async verify() { return true; }
  });
  return { registry, state };
}

async function policyRejectsPlanAssertions() {
  const policy = createApprovalPolicy();
  const discovery = jobs.createPlan({
    jobKind: 'discovery.server', lifecyclePhase: 'Discover',
    targetIdentity: 'sqlite:one', steps: [{ stepId: 'read' }],
    policy: { approvalRequired: false, readOnly: true }
  });
  const run = jobs.createRun(discovery, { runId: 'read' });
  assert.deepEqual(policy.evaluate({plan: discovery, run}), { allowed:true, classification:'read-only' });
  const spoofed = jobs.createPlan({
    jobKind: 'administration.bootstrap', lifecyclePhase:'Establish',
    targetIdentity:'sqlite:one', steps:[{stepId:'delete'}],
    policy:{approvalRequired:false,readOnly:true}
  });
  assert.equal(policy.evaluate({plan:spoofed,run:jobs.createRun(spoofed)}).reason,'job-kind-not-qualified');

  const malformed = jobs.createPlan({
    jobKind:'discovery.server', lifecyclePhase:'Discover', targetIdentity:'sqlite:one',
    steps:[{stepId:'read'}],policy:{approvalRequired:false,readOnly:true,hostMutation:true}
  });
  assert.equal(policy.evaluate({plan:malformed,run:jobs.createRun(malformed)}).reason,'read-only-policy-mismatch');
  assert.equal(policy.evaluate({plan:discovery,run:jobs.createRun(spoofed)}).reason,
    'invalid-job-authorization-context');
  assert.throws(()=>createApprovalPolicy({readOnlyKinds:['x','x']}),/unique/);
  assert.throws(()=>createApprovalPolicy({readOnlyKinds:['x'],mutationKinds:['x']}),/cannot be/);
  assert.throws(()=>createApprovalPolicy({clock:5}),/clock/);
}

async function durableAuthorisedGrant() {
  await withDirectory(async filename => {
    let now=NOW;
    let calls=0;
    let authenticatedPrincipal='engineer';
    const clock=()=>now;
    let store=createStore({
      filename,clock,
      approvalAuthorizer(intent,run,plan) {
        calls++;
        return { allowed: authenticatedPrincipal!=='intruder' &&
          run.requestedBy==='engineer' && plan.jobKind===KIND,
          approverId: authenticatedPrincipal };
      }
    });
    const plan=mutablePlan();
    await submitForApproval(store,plan,'approved');
    assert.throws(()=>store.approveRun(request('approved',plan,{approverId:'dba'})),/distinct/,
      'a spoofed caller approverId cannot override the authenticated requester');
    authenticatedPrincipal='intruder';
    assert.throws(()=>store.approveRun(request('approved',plan,{approverId:'dba'})),/authorizer denied/);
    authenticatedPrincipal='dba';
    assert.throws(()=>store.approveRun(request('approved',plan,{planHash:'0'.repeat(64)})),/mismatch/);
    assert.throws(()=>store.approveRun(request('approved',plan,{targetIdentity:'mysql:other'})),/mismatch/);
    assert.throws(()=>store.approveRun(request('approved',plan,{expiresAt:new Date(NOW-1).toISOString()})),/expiry/);
    assert.equal(store.getApproval('approved'),null);
    assert.equal(store.getRun('approved').status,'awaiting-approval');
    assert.equal(calls,2);

    const queued=store.approveRun(request('approved',plan));
    assert.equal(queued.status,'queued');
    assert.equal(store.getApproval('approved').runId,'approved');
    assert.deepEqual(store.listEvents('approved').map(e=>e.type),
      ['planned','status','approval-granted']);
    assert.throws(()=>store.approveRun(request('approved',plan)),/awaiting-approval/);
    store.close();

    // Approval survives process restart, without persisting credentials or
    // requiring an authorizer on the read-only worker process.
    store=createStore({filename,clock});
    const grant=store.getApproval('approved');
    assert.equal(grant.planHash,plan.planHash);
    assert.equal(grant.targetIdentity,'mysql:primary');
    assert.equal(grant.approverId,'dba');
    const policy=createApprovalPolicy({readOnlyKinds:[],mutationKinds:[KIND],clock});
    const {registry,state}=qualifiedRegistry();
    const worker=createWorker({store,registry,workerId:'qualified',clock,approvalPolicy:policy});
    assert.deepEqual(await worker.runOnce(),{runId:'approved',status:'succeeded'});
    assert.equal(state.writes,1);
    assert.equal(state.reconciliations,1);
    assert.equal(store.getRun('approved').lease,undefined);
    assert.ok(!JSON.stringify(store.listEvents('approved')).includes('password'));
    store.close();
  });
}

async function approvalsCannotBeBorrowedOrExpired() {
  await withDirectory(async filename => {
    let now=NOW;
    const clock=()=>now;
    const store=createStore({filename,clock,approvalAuthorizer:()=>({allowed:true,approverId:'dba'})});
    const plan=mutablePlan();
    await submitForApproval(store,plan,'expired');
    store.approveRun(request('expired',plan,{expiresAt:new Date(NOW+1000).toISOString()}));
    now+=2000;
    const {registry,state}=qualifiedRegistry();
    const policy=createApprovalPolicy({readOnlyKinds:[],mutationKinds:[KIND],clock});
    const worker=createWorker({store,registry,workerId:'expired-worker',clock,approvalPolicy:policy});
    assert.equal((await worker.runOnce()).status,'blocked');
    assert.equal(store.getRun('expired').reason,'approval-denied:approval-expired-or-invalid');
    assert.equal(state.writes,0);
    now=NOW;
    await submitForApproval(store,plan,'borrowed');
    await jobs.createKernel(store).advance('borrowed',1,'queued');
    const second=createWorker({store,registry,workerId:'borrowed-worker',clock,approvalPolicy:policy});
    assert.equal((await second.runOnce()).status,'blocked');
    assert.equal(store.getRun('borrowed').reason,'approval-denied:approval-identity-mismatch');
    assert.equal(state.writes,0);
    store.close();
  });
}

async function unqualifiedMutationNeverExecutes() {
  await withDirectory(async filename => {
    const store=createStore({filename,clock:()=>NOW,approvalAuthorizer:()=>({allowed:true,approverId:'dba'})});
    const plan=mutablePlan();
    await submitForApproval(store,plan,'unqualified');
    store.approveRun(request('unqualified',plan));
    const {registry,state}=qualifiedRegistry();
    // Default policy permits only the two shipped read-only adapters.
    const worker=createWorker({store,registry,workerId:'deny-all',clock:()=>NOW});
    assert.equal((await worker.runOnce()).status,'blocked');
    assert.equal(state.writes,0);
    assert.equal(store.getRun('unqualified').reason,'approval-denied:job-kind-not-qualified');
    store.close();
  });
  await withDirectory(async filename=>{
    const store=createStore({filename,clock:()=>NOW,approvalAuthorizer:()=>({allowed:true,approverId:'dba'})});
    const plan=mutablePlan();
    await submitForApproval(store,plan,'no-fence');
    store.approveRun(request('no-fence',plan));
    const registry=jobs.createExecutorRegistry();
    let executed=false;
    registry.register(KIND,{async execute(){executed=true;},async verify(){return true;}});
    const policy=createApprovalPolicy({readOnlyKinds:[],mutationKinds:[KIND],clock:()=>NOW});
    const worker=createWorker({store,registry,workerId:'fence-check',clock:()=>NOW,approvalPolicy:policy});
    assert.equal((await worker.runOnce()).status,'blocked');
    assert.equal(store.getRun('no-fence').reason,'approval-denied:mutation-executor-not-qualified');
    assert.equal(executed,false);
    store.close();
  });
}

async function reconciliationDeniesBeforeSideEffects() {
  await withDirectory(async filename=>{
    const store=createStore({filename,clock:()=>NOW,approvalAuthorizer:()=>({allowed:true,approverId:'dba'})});
    const plan=mutablePlan();
    await submitForApproval(store,plan,'no-reconcile');
    store.approveRun(request('no-reconcile',plan));
    const {registry,state}=qualifiedRegistry({reconcile:()=>false});
    const policy=createApprovalPolicy({readOnlyKinds:[],mutationKinds:[KIND],clock:()=>NOW});
    const worker=createWorker({store,registry,workerId:'check',clock:()=>NOW,approvalPolicy:policy});
    assert.equal((await worker.runOnce()).status,'blocked');
    assert.equal(store.getRun('no-reconcile').reason,'mutation-target-reconciliation-unconfirmed');
    assert.equal(state.reconciliations,1);
    assert.equal(state.writes,0);
    store.close();
  });
}

async function upgradeStoreFromV1() {
  await withDirectory(async filename=>{
    let store=createStore({filename});
    const plan=mutablePlan();
    await submitForApproval(store,plan,'historic');
    store.close();
    // Simulate a valid existing v1 file: same original tables/run contents.
    const db=new DatabaseSync(filename);
    db.exec('DROP TABLE job_approvals; PRAGMA user_version = 1;');
    db.close();
    store=createStore({filename});
    assert.equal(store.schemaVersion,3);
    assert.equal(store.getRun('historic').status,'awaiting-approval');
    assert.equal(store.getApproval('historic'),null);
    store.close();
  });
}

(async()=>{
  await policyRejectsPlanAssertions();
  await durableAuthorisedGrant();
  await approvalsCannotBeBorrowedOrExpired();
  await unqualifiedMutationNeverExecutes();
  await reconciliationDeniesBeforeSideEffects();
  await upgradeStoreFromV1();
  console.log('NuBloxSQL durable approval policy and authorization contract: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
