'use strict';
const assert = require('node:assert/strict');
const jobs = require('../lib/jobs/JobKernel');

function fixture() {
  return jobs.createPlan({
    jobKind: 'administration.bootstrap', lifecyclePhase: 'Establish', targetIdentity: 'postgresql:example',
    steps: [{stepId: 'inspect'}, {stepId: 'apply'}], policy: { approvalRequired: true }
  });
}

async function main() {
  const plan = fixture();
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.planHash.length, 64);
  assert.equal(plan.planHash, jobs.createPlan({ policy: { approvalRequired: true }, steps: [{stepId:'inspect'}, {stepId:'apply'}], targetIdentity: 'postgresql:example', lifecyclePhase: 'Establish', jobKind: 'administration.bootstrap' }).planHash);
  assert.ok(Object.isFrozen(plan));
  assert.ok(Object.isFrozen(plan.steps[0]));
  assert.throws(() => jobs.createPlan({ jobKind: 'test', lifecyclePhase: 'Use', targetIdentity:'one', steps:[{stepId:'x',password:'secret'}] }), /secret-bearing/);
  assert.throws(() => jobs.createPlan({jobKind: 'test', lifecyclePhase:'Use', targetIdentity:'one', steps:[{stepId:'x'},{stepId:'x'}]}), /duplicate/);
  assert.throws(() => jobs.createPlan({jobKind:'test',lifecyclePhase:'Use',targetIdentity:'one',steps:[{stepId:'x',data:Infinity}]}), /finite JSON/);
  assert.throws(() => jobs.createPlan({jobKind:'test',lifecyclePhase:'Use',targetIdentity:'one',steps:[{stepId:'x'}],planHash:'tampered'}), /generated/);
  assert.throws(() => jobs.createRun({...plan,schemaVersion:2}), /valid immutable job plan/);

  const registry = jobs.createExecutorRegistry();
  const executor = {execute: async () => true};
  registry.register('administration.bootstrap', executor);
  assert.equal(registry.resolve('administration.bootstrap'), executor);
  assert.equal(registry.resolve('missing'), null);
  assert.throws(() => registry.register('administration.bootstrap', executor), /already registered/);
  assert.throws(() => registry.register('broken', {}), /execute/);

  const run = jobs.createRun(plan, {runId: 'run-1', now: '2026-10-09T00:00:00Z'});
  assert.equal(run.status, 'planned');
  assert.equal(run.version, 0);
  assert.ok(Object.isFrozen(run));
  assert.throws(() => jobs.transition(run, 'succeeded'), /invalid job transition/);
  assert.throws(() => jobs.checkpoint(run, {done:true}), /requires a running/);
  const awaiting = jobs.transition(run, 'awaiting-approval');
  const queued = jobs.transition(awaiting, 'queued');
  const leased = jobs.transition(queued, 'leased');
  const running = jobs.transition(leased, 'running');
  const checked = jobs.checkpoint(running, { stepId: 'inspect', evidence: 'sha256:abc' }, {now:'2026-10-09T00:00:05Z'});
  assert.equal(checked.version, 5);
  assert.equal(checked.updatedAt, '2026-10-09T00:00:05Z');
  assert.equal(checked.checkpoint.stepId, 'inspect');
  assert.equal(running.checkpoint, null);
  assert.throws(() => jobs.checkpoint(running, {accessToken:'x'}), /secret-bearing/);
  const leasedRunning = Object.freeze({...running, lease:Object.freeze({workerId:'worker',fence:1,expiresAt:'2026-10-09T00:01:00Z'})});
  assert.equal(jobs.transition(leasedRunning,'waiting').lease, undefined);
  const verifying = jobs.transition(checked, 'verifying');
  const success = jobs.transition(verifying, 'succeeded');
  assert.ok(jobs.TERMINAL.includes(success.status));
  assert.throws(() => jobs.transition(success, 'queued'), /invalid job transition/);

  const records = new Map();
  const plans = new Map();
  const events = [];
  const store = {
    async savePlan(p) { plans.set(p.planHash, p); },
    async getPlan(hash) { return plans.get(hash); },
    async createRun(r, event) { if(records.has(r.runId)) throw new Error('duplicate run'); records.set(r.runId, r); events.push(event); },
    async getRun(id) { return records.get(id); },
    async commitTransition(id, version, next, event) {
      const current = records.get(id);
      if (!current || current.version !== version) throw new Error('CAS conflict');
      records.set(id, next); events.push(event);
    },
    async leaseNextRun({workerId, expiresAt}) {
      const current = [...records.values()].find(r => r.status === 'queued');
      if (!current) return null;
      const leased = Object.freeze({...current, status: 'leased', version: current.version + 1, lease: Object.freeze({workerId, fence: 1, expiresAt})});
      records.set(current.runId, leased);
      events.push({type: 'leased', workerId});
      return leased;
    }
  };
  const kernel = jobs.createKernel(store);
  assert.equal(await kernel.leaseNext('worker', '2026-10-09T00:00:00Z', '2026-10-09T00:01:00Z'), null);
  await kernel.submit(plan, {runId:'durable-1',now:'2026-10-09T00:00:00Z'});
  assert.equal(plans.size, 1);
  assert.equal(events.length, 1);
  const next = await kernel.advance('durable-1', 0, 'queued');
  assert.equal(next.status, 'queued');
  assert.equal(events.length, 2);
  await assert.rejects(kernel.advance('durable-1', 0, 'leased'), /version conflict/);
  await assert.rejects(kernel.advance('durable-1', 1, 'leased'), /atomic JobStore/);
  await assert.rejects(kernel.leaseNext('worker', 'bad', 'bad'), /lease time range/);
  const claimed = await kernel.leaseNext('worker', '2026-10-09T00:00:00Z', '2026-10-09T00:01:00Z');
  assert.equal(claimed.status, 'leased');
  await assert.rejects(kernel.advance('durable-1', 2, 'running', {workerId: 'intruder', fence: 1}), /fencing token/);
  const started = await kernel.advance('durable-1', 2, 'running', {workerId: 'worker', fence: 1});
  assert.equal(started.status, 'running');
  await assert.rejects(kernel.checkpoint('durable-1', 3, {stepId:'inspect'}), /fencing token/);
  const persisted = await kernel.checkpoint('durable-1', 3, {stepId:'inspect'}, {workerId:'worker',fence:1});
  assert.equal(persisted.version, 4);
  assert.equal(events.at(-1).type, 'checkpoint');
  const cancelling = await kernel.advance('durable-1', 4, 'cancelling', {workerId:'worker',fence:1});
  await assert.rejects(kernel.advance('durable-1', cancelling.version, 'cancelled'), /fencing token/);
  const cancelled = await kernel.advance('durable-1', cancelling.version, 'cancelled', {workerId:'worker',fence:1});
  assert.equal(cancelled.lease, undefined);
  await assert.rejects(kernel.submit({...plan, steps:[{stepId:'altered'}]}), /hash or schema version/);
  await assert.rejects(kernel.submit({...plan, schemaVersion:2}), /hash or schema version/);
  assert.throws(() => jobs.createKernel({}), /durable JobStore/);
  console.log('NuBloxSQL durable job kernel foundational contracts: PASS');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
