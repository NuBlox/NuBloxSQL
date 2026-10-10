'use strict';

const jobs = require('./JobKernel');

function nonEmpty(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(label + ' must be a nonempty string');
  return value;
}

function createWorker(options = {}) {
  const { store, registry } = options;
  const workerId = nonEmpty(options.workerId, 'workerId');
  if (!store || typeof store.getPlan !== 'function' || typeof store.renewLease !== 'function') {
    throw new TypeError('job worker requires a durable JobStore with getPlan and renewLease');
  }
  if (!registry || typeof registry.resolve !== 'function') throw new TypeError('job worker requires an executor registry');
  const leaseMs = options.leaseMs === undefined ? 30000 : options.leaseMs;
  const heartbeatMs = options.heartbeatMs === undefined ? Math.floor(leaseMs / 3) : options.heartbeatMs;
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 100 || leaseMs > 86400000 ||
      !Number.isSafeInteger(heartbeatMs) || heartbeatMs < 10 || heartbeatMs >= leaseMs / 2) {
    throw new RangeError('leaseMs must be 100..86400000 and heartbeatMs must be >=10 and less than half the lease');
  }
  const clock = options.clock || Date.now;
  if (typeof clock !== 'function') throw new TypeError('worker clock must be a function');
  const kernel = jobs.createKernel(store);
  let busy = false;

  function timestamp() {
    const value = clock();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.valueOf())) throw new TypeError('worker clock is invalid');
    return date.toISOString();
  }

  function after(ms) {
    const date = new Date(Date.parse(timestamp()) + ms);
    return date.toISOString();
  }

  async function runOnce() {
    if (busy) throw new Error('worker already executing a job');
    busy = true;
    try {
      const leased = await kernel.leaseNext(workerId, timestamp(), after(leaseMs));
      if (!leased) return null;
      const runId = leased.runId;
      const fence = leased.lease.fence;
      let version = leased.version;
      let leaseLost = false;
      const controller = new AbortController();
      let heartbeat;
      const leaseIdentity = { workerId, fence };
      const contextRun = () => store.getRun(runId);

      async function advance(status, reason) {
        if (leaseLost) throw new Error('job worker has lost its lease');
        const next = await kernel.advance(runId, version, status, {
          ...leaseIdentity,
          now: timestamp(),
          ...(reason ? { reason } : {})
        });
        version = next.version;
        return next;
      }

      async function saveCheckpoint(value) {
        if (leaseLost) throw new Error('job worker has lost its lease');
        const next = await kernel.checkpoint(runId, version, value, {
          ...leaseIdentity,
          now: timestamp()
        });
        version = next.version;
      }

      function renew() {
        if (leaseLost) return;
        try {
          store.renewLease({
            runId, ...leaseIdentity, expectedVersion: version,
            now: timestamp(), expiresAt: after(leaseMs)
          });
        } catch (_) {
          leaseLost = true;
          controller.abort();
        }
      }

      try {
        const plan = await store.getPlan(leased.planHash);
        if (!plan || plan.planHash !== leased.planHash ||
            plan.schemaVersion !== jobs.SCHEMA_VERSION ||
            !Array.isArray(plan.steps) || plan.steps.length === 0) {
          await advance('blocked', 'missing-or-invalid-plan');
          return Object.freeze({ runId, status: 'blocked' });
        }
        // No approval-policy engine exists yet: fail closed on approval-gated work.
        if (!plan.policy || plan.policy.approvalRequired !== false) {
          await advance('blocked', 'approval-policy-not-qualified');
          return Object.freeze({ runId, status: 'blocked' });
        }

        const executor = registry.resolve(plan.jobKind);
        if (!executor || typeof executor.execute !== 'function' || typeof executor.verify !== 'function') {
          await advance('blocked', 'qualified-executor-or-verifier-unavailable');
          return Object.freeze({ runId, status: 'blocked' });
        }

        const existing = leased.checkpoint;
        let startIndex = 0;
        if (existing !== null && existing !== undefined) {
          if (!Number.isSafeInteger(existing.nextStepIndex) || existing.nextStepIndex < 0 ||
              existing.nextStepIndex > plan.steps.length ||
              (existing.nextStepIndex > 0 &&
               existing.lastCompletedStepId !== plan.steps[existing.nextStepIndex - 1].stepId)) {
            await advance('blocked', 'invalid-checkpoint');
            return Object.freeze({ runId, status: 'blocked' });
          }
          startIndex = existing.nextStepIndex;
        }

        await advance('running');
        heartbeat = setInterval(renew, heartbeatMs);

        for (let i = startIndex; i < plan.steps.length; i++) {
          if (controller.signal.aborted || leaseLost) throw new Error('lease lost during execution');
          const step = plan.steps[i];
          const result = await executor.execute(Object.freeze({
            plan, runId, step, stepIndex: i, workerId, fence,
            checkpoint: (await contextRun()).checkpoint,
            signal: controller.signal
          }));
          if (controller.signal.aborted || leaseLost) throw new Error('lease lost during execution');
          await saveCheckpoint({
            nextStepIndex: i + 1, lastCompletedStepId: step.stepId,
            evidence: result === undefined ? null : result
          });
        }

        await advance('verifying');
        if (controller.signal.aborted || leaseLost) throw new Error('lease lost during verification');
        const verification = await executor.verify(Object.freeze({
          plan, runId, workerId, fence,
          checkpoint: (await contextRun()).checkpoint,
          signal: controller.signal
        }));
        if (controller.signal.aborted || leaseLost) throw new Error('lease lost during verification');

        const verified = verification === true ||
          (verification !== null && typeof verification === 'object' && verification.verified === true);
        if (!verified) {
          await advance('blocked', 'post-execution-verification-unconfirmed');
          return Object.freeze({ runId, status: 'blocked' });
        }
        await advance('succeeded', 'post-execution-verified');
        return Object.freeze({ runId, status: 'succeeded' });
      } catch (_) {
        controller.abort();
        if (leaseLost) return Object.freeze({ runId, status: 'orphaned', reason: 'lease-lost' });
        // An executor can have committed side effects before throwing: never replay automatically.
        try {
          await advance('blocked', 'execution-outcome-unconfirmed');
          return Object.freeze({ runId, status: 'blocked' });
        } catch (_) {
          return Object.freeze({ runId, status: 'orphaned', reason: 'state-or-lease-conflict' });
        }
      } finally {
        if (heartbeat) clearInterval(heartbeat);
      }
    } finally {
      busy = false;
    }
  }

  return Object.freeze({ workerId, runOnce });
}

module.exports = Object.freeze({ createWorker });
