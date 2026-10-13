'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jobs = require('../lib/jobs/JobKernel');
const { createStore } = require('../lib/jobs/SqliteJobStore');
const { createWorker } = require('../lib/jobs/JobWorker');
const { createApprovalPolicy } = require('../lib/jobs/JobApprovalPolicy');
const { createSchedulerService } = require('../lib/jobs/JobSchedulerService');

const START = Date.parse('2026-10-13T09:00:00.000Z');

function fakeTimers() {
  const scheduled = new Map();
  let sequence = 0;
  return {
    setTimeout(callback, delay) {
      const id = ++sequence;
      scheduled.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { scheduled.delete(id); },
    get size() { return scheduled.size; },
    get delay() { return [...scheduled.values()][0]?.delay ?? null; },
    fire() {
      const first = scheduled.entries().next().value;
      assert.ok(first, 'expected a pending timer');
      scheduled.delete(first[0]);
      first[1].callback();
    }
  };
}

function trustedRegistry() {
  const registry = jobs.createExecutorRegistry();
  registry.register('inspection.host', {
    retrySafe: true,
    async execute() { return { completed: true }; },
    async verify() { return true; }
  });
  return registry;
}

async function withStore(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nublox-scheduler-service-'));
  const filename = path.join(dir, 'jobs.sqlite');
  let now = START;
  let store = createStore({ filename, clock: () => now });
  try {
    const context = {
      get store() { return store; },
      get now() { return now; },
      setTime(value) { now = value; },
      restartStore() { store.close(); store = createStore({ filename, clock: () => now }); },
      registry: trustedRegistry(),
      policy: createApprovalPolicy({ clock: () => now }),
      timers: fakeTimers()
    };
    await fn(context);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function scheduledInspection(ctx) {
  const plan = jobs.createPlan({
    jobKind: 'inspection.host', lifecyclePhase: 'Discover',
    targetIdentity: 'local-host:scheduler-test',
    steps: [{ stepId: 'inspect' }],
    policy: { approvalRequired: false, readOnly: true, hostMutation: false }
  });
  return ctx.store.createSchedule({
    scheduleId: 'host-inspection', plan,
    recurrence: { kind: 'interval', everyMinutes: 1, anchorAt: new Date(START).toISOString() },
    approvalPolicy: ctx.policy, registry: ctx.registry
  });
}

async function dispatchAndRestart() {
  await withStore(async ctx => {
    scheduledInspection(ctx);
    const events = [];
    const createService = () => createSchedulerService({
      store: ctx.store, registry: ctx.registry, approvalPolicy: ctx.policy,
      pollIntervalMs: 100, timers: ctx.timers,
      clock: () => ctx.now,
      onEvent: event => events.push(event)
    });
    let service = createService();
    assert.equal(service.status().phase, 'idle');
    assert.equal((await service.start()).queued, 1);
    assert.equal(service.status().polls, 1);
    assert.equal(ctx.timers.size, 1);
    assert.equal(ctx.timers.delay, 100);
    const firstRun = ctx.store.listScheduleEvents('host-inspection').find(event => event.type === 'run-queued');
    assert.ok(firstRun && firstRun.runId);
    assert.equal(ctx.store.getRun(firstRun.runId).status, 'queued');
    // A no-overlap policy must treat even an unstarted queued run as active.
    ctx.setTime(START + 60000);
    ctx.timers.fire();
    assert.deepEqual(await service.pollNow(), { queued: 0, skipped: 1, disabled: 0 });
    assert.equal(service.status().skipped, 1);
    assert.equal(ctx.store.listScheduleEvents('host-inspection').at(-1).reason, 'overlap-forbidden');
    assert.equal((await service.stop()).phase, 'stopped');
    assert.equal(ctx.timers.size, 0);
    assert.ok(events.every(event => !JSON.stringify(event).includes('local-host:scheduler-test')));

    // The scheduler process itself retains no in-memory authoritative schedule.
    ctx.restartStore();
    service = createService();
    const worker = createWorker({
      store: ctx.store, registry: ctx.registry,
      approvalPolicy: ctx.policy, workerId: 'test-worker', clock: () => ctx.now
    });
    assert.equal((await worker.runOnce()).status, 'succeeded');
    ctx.setTime(START + 120000);
    assert.equal((await service.start()).queued, 1);
    assert.equal(ctx.store.listScheduleEvents('host-inspection')
      .filter(event => event.type === 'run-queued').length, 2);
    assert.equal((await service.stop()).phase, 'stopped');
    assert.equal(ctx.timers.size, 0);
  });
}

async function boundedFailureAndSanitizedDiagnostics() {
  const timers = fakeTimers();
  let now = START;
  let calls = 0;
  const events = [];
  const store = {
    kind: 'sqlite-local', distributed: false,
    dispatchDueSchedules() {
      calls++;
      if (calls <= 2) throw new Error('password=hunter2 /private/customer-db');
      return [];
    }
  };
  const service = createSchedulerService({
    store, registry: trustedRegistry(), approvalPolicy: createApprovalPolicy(),
    pollIntervalMs: 100, maxBackoffMs: 250,
    clock: () => now, timers,
    onEvent: event => {
      events.push(event);
      throw new Error('observability sink failed; must not influence service');
    }
  });
  await service.start();
  assert.equal(service.status().failures, 1);
  assert.equal(service.status().lastError, 'dispatch-failed');
  assert.equal(service.status().consecutiveFailures, 1);
  assert.equal(timers.delay, 100);
  now += 100;
  timers.fire();
  await service.pollNow();
  assert.equal(service.status().failures, 2);
  assert.equal(service.status().consecutiveFailures, 2);
  assert.equal(timers.delay, 200);
  now += 200;
  timers.fire();
  assert.deepEqual(await service.pollNow(), { queued: 0, skipped: 0, disabled: 0 });
  assert.equal(service.status().consecutiveFailures, 0);
  assert.equal(service.status().lastError, null);
  assert.equal(service.status().polls, 3);
  assert.equal(timers.delay, 100);
  assert.ok(events.some(event => event.type === 'poll-failed'));
  assert.ok(!JSON.stringify({status: service.status(), events}).includes('hunter2'));
  await service.stop();
  assert.equal(timers.size, 0);
}

async function stopWaitsForInFlightAndPreventsFurtherPolling() {
  const timers = fakeTimers();
  let release;
  let dispatches = 0;
  const store = {
    kind: 'sqlite-local', distributed: false,
    dispatchDueSchedules() {
      dispatches++;
      return new Promise(resolve => { release = resolve; });
    }
  };
  const service = createSchedulerService({
    store, approvalPolicy: createApprovalPolicy(), registry: trustedRegistry(),
    pollIntervalMs: 100, timers
  });
  const first = service.start();
  await Promise.resolve();
  assert.equal(dispatches, 1);
  // Concurrent poll requests must share the same in-flight work.
  const second = service.pollNow();
  const stopping = service.stop();
  assert.equal(service.status().phase, 'stopping');
  assert.equal(service.status().inFlight, true);
  assert.equal(timers.size, 0);
  release([{status: 'queued'}]);
  await second;
  await first;
  assert.equal((await stopping).phase, 'stopped');
  assert.equal(service.status().queued, 1);
  assert.equal(dispatches, 1);
  assert.equal(timers.size, 0);
  await assert.rejects(service.pollNow(), /not running/);
  const restarted = service.start();
  await Promise.resolve();
  assert.equal(dispatches, 2);
  const stoppedAgain = service.stop();
  release([]);
  await restarted;
  await stoppedAgain;
  assert.equal(timers.size, 0);
}

async function qualificationAndInputChecks() {
  const base = { store: { kind: 'sqlite-local', distributed: false, dispatchDueSchedules() { return []; } },
    registry: trustedRegistry(), approvalPolicy: createApprovalPolicy() };
  assert.throws(() => createSchedulerService({}), /same-host SQLite/);
  assert.throws(() => createSchedulerService({ ...base, store: {kind:'network'} }), /same-host SQLite/);
  assert.throws(() => createSchedulerService({ ...base, pollIntervalMs: 99 }), /pollIntervalMs/);
  assert.throws(() => createSchedulerService({ ...base, maxBackoffMs: 100, pollIntervalMs: 200 }), /maxBackoffMs/);
  assert.throws(() => createSchedulerService({ ...base, limit: 101 }), /limit/);
  assert.throws(() => createSchedulerService({ ...base, onEvent: 'callback' }), /onEvent/);
  const service = createSchedulerService(base);
  assert.equal(service.status().phase, 'idle');
  assert.deepEqual(Object.keys(service).sort(), ['pollNow','start','status','stop']);
  // No undocumented accidental publication of the internal service.
  assert.equal(require('../package.json').files.includes('lib/jobs/'), false);
}

(async () => {
  await dispatchAndRestart();
  await boundedFailureAndSanitizedDiagnostics();
  await stopWaitsForInFlightAndPreventsFurtherPolling();
  await qualificationAndInputChecks();
  console.log('NuBloxSQL internal scheduler service: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
