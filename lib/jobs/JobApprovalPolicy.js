'use strict';

// Internal, deny-by-default job authorization policy. The plan never grants its
// own authority: classification is supplied by trusted worker configuration.
const DEFAULT_READ_ONLY_KINDS = Object.freeze(['discovery.server', 'inspection.host']);
const SHA256 = /^[a-f0-9]{64}$/;

function nonEmpty(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(label + ' must be a nonempty string');
  return value;
}

function kinds(value, label) {
  if (!Array.isArray(value) || value.some(kind => typeof kind !== 'string' || !kind.trim()) ||
      new Set(value).size !== value.length) {
    throw new TypeError(label + ' must be an array of unique nonempty job kinds');
  }
  return new Set(value);
}

function createApprovalPolicy(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('job approval policy options must be an object');
  }
  const reads = kinds(options.readOnlyKinds === undefined ? DEFAULT_READ_ONLY_KINDS : options.readOnlyKinds,
    'readOnlyKinds');
  const writes = kinds(options.mutationKinds === undefined ? [] : options.mutationKinds, 'mutationKinds');
  for (const kind of reads) if (writes.has(kind)) throw new Error('job kind cannot be read-only and mutating');
  const clock = options.clock || Date.now;
  if (typeof clock !== 'function') throw new TypeError('approval policy clock must be a function');

  function denied(reason) { return Object.freeze({ allowed: false, reason }); }
  function evaluate({ plan, run, approval, executor } = {}) {
    if (!plan || !run || !SHA256.test(plan.planHash || '') ||
        run.planHash !== plan.planHash || typeof plan.jobKind !== 'string' ||
        typeof plan.targetIdentity !== 'string' || typeof run.runId !== 'string') {
      return denied('invalid-job-authorization-context');
    }
    if (reads.has(plan.jobKind)) {
      if (!plan.policy || plan.policy.readOnly !== true ||
          plan.policy.approvalRequired !== false || plan.policy.hostMutation === true) {
        return denied('read-only-policy-mismatch');
      }
      return Object.freeze({ allowed: true, classification: 'read-only' });
    }
    if (!writes.has(plan.jobKind)) return denied('job-kind-not-qualified');
    if (!plan.policy || plan.policy.approvalRequired !== true ||
        plan.policy.readOnly !== false || plan.policy.hostMutation === false) {
      return denied('mutation-policy-mismatch');
    }
    // No default mutation adapters are enabled. A trusted integrator must
    // additionally qualify a target-fenced executor for this exact job kind.
    if (!executor || executor.targetSideFencing !== true ||
        typeof executor.reconcile !== 'function') {
      return denied('mutation-executor-not-qualified');
    }
    if (!approval || approval.runId !== run.runId || approval.planHash !== plan.planHash ||
        approval.targetIdentity !== plan.targetIdentity ||
        approval.jobKind !== plan.jobKind || !nonEmptyOrFalse(approval.approverId) ||
        !nonEmptyOrFalse(run.requestedBy) || approval.approverId === run.requestedBy) {
      return denied('approval-identity-mismatch');
    }
    const approvedAt = Date.parse(approval.approvedAt);
    const expiresAt = Date.parse(approval.expiresAt);
    const now = clock();
    const nowMs = now instanceof Date ? now.valueOf() : Number(now);
    if (!Number.isFinite(approvedAt) || !Number.isFinite(expiresAt) ||
        !Number.isFinite(nowMs) || approvedAt > nowMs || expiresAt <= nowMs ||
        approvedAt >= expiresAt) {
      return denied('approval-expired-or-invalid');
    }
    return Object.freeze({ allowed: true, classification: 'approved-mutation' });
  }

  return Object.freeze({ evaluate });
}

function nonEmptyOrFalse(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

module.exports = Object.freeze({ DEFAULT_READ_ONLY_KINDS, createApprovalPolicy });
