'use strict';

// Internal read-only host inspection adapter over the existing local-host provider.
// Host access stays process-bound; only digests and counts enter durable job state.

const lifecycleProvider = require('../lifecycle/InstallationProvider');
const localHost = require('../lifecycle/LocalHostInstallationProvider');
const jobs = require('./JobKernel');

const KIND = 'inspection.host';
const STEP_ID = 'inspect-local-host';
const TARGET_PATTERN = /^local-host:[a-z0-9][a-z0-9._-]{0,127}$/i;
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

function targetIdentity(value) {
  if (typeof value !== 'string' || !TARGET_PATTERN.test(value)) {
    throw new TypeError('host inspection targetIdentity must be a credential-free local-host:<hostname>');
  }
  return value;
}

function providerId(value) {
  if (typeof value !== 'string' || !PROVIDER_ID_PATTERN.test(value)) {
    throw new TypeError('host inspection providerId must be a credential-free opaque identifier');
  }
  return value;
}

function planHostInspection(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('host inspection plan input must be an object');
  }
  const target = targetIdentity(input.targetIdentity);
  const id = providerId(input.providerId === undefined ? localHost.PROVIDER_ID : input.providerId);
  return jobs.createPlan({
    jobKind: KIND,
    lifecyclePhase: 'Discover',
    targetIdentity: target,
    targetScope: 'local-process-host',
    providerId: id,
    policy: { approvalRequired: false, readOnly: true, hostMutation: false },
    steps: [{ stepId: STEP_ID }]
  });
}

function requireReadOnlyProvider(provider) {
  lifecycleProvider.validate(provider);
  if (provider.kind !== 'local-host' || provider.metadata?.readOnly !== true ||
      provider.metadata?.hostMutation !== false ||
      provider.metadata?.targetScope !== 'local-process-host' ||
      !Array.isArray(provider.actions) || provider.actions.length !== 1 ||
      provider.actions[0] !== 'inspect-target' || provider.executeAction !== undefined) {
    throw new Error('host inspection requires the read-only local-host provider');
  }
  return providerId(provider.id);
}

function summarize(report, expectedTarget, expectedProviderId) {
  lifecycleProvider.validateTarget(report);
  if (report.schemaVersion !== lifecycleProvider.SCHEMA_VERSION ||
      report.targetId !== expectedTarget ||
      report.provider.id !== expectedProviderId ||
      report.provider.kind !== 'local-host' ||
      report.provider.metadata?.readOnly !== true ||
      report.provider.metadata?.hostMutation !== false ||
      report.provider.metadata?.targetScope !== 'local-process-host' ||
      !Array.isArray(report.provider.actions) ||
      report.provider.actions.length !== 1 ||
      report.provider.actions[0] !== 'inspect-target' ||
      !FINGERPRINT_PATTERN.test(report.inspectionHash)) {
    throw new Error('host inspection evidence does not match the bound read-only target');
  }
  // Native resource paths, installed metadata, usernames, platform facts and
  // command output are NEVER copied into the job checkpoint or audit events.
  return Object.freeze({
    schemaVersion: 1,
    inspectionHash: report.inspectionHash,
    installedCount: report.installed.length,
    resourceCount: report.resources.length
  });
}

function createHostInspectionExecutor(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('host inspection executor options must be an object');
  }
  const expectedTarget = targetIdentity(options.targetIdentity);
  if (options.providerOptions !== undefined &&
      (!options.providerOptions || typeof options.providerOptions !== 'object' ||
       Array.isArray(options.providerOptions))) {
    throw new TypeError('host inspection providerOptions must be an object');
  }
  // Instantiate the qualified implementation, not an arbitrary inspectTarget callback.
  const provider = localHost.create(options.providerOptions || {});
  const expectedProviderId = requireReadOnlyProvider(provider);

  function validateInvocation(context, step) {
    if (!context || typeof context !== 'object') throw new TypeError('host inspection context required');
    if (context.signal?.aborted) throw new Error('host inspection aborted');
    const plan = context.plan;
    if (!plan || plan.jobKind !== KIND || plan.lifecyclePhase !== 'Discover' ||
        plan.targetIdentity !== expectedTarget ||
        plan.targetScope !== 'local-process-host' ||
        plan.providerId !== expectedProviderId ||
        !plan.policy || plan.policy.approvalRequired !== false ||
        plan.policy.readOnly !== true || plan.policy.hostMutation !== false ||
        !Array.isArray(plan.steps) || plan.steps.length !== 1 ||
        plan.steps[0]?.stepId !== STEP_ID ||
        (step !== undefined && (!step || step.stepId !== STEP_ID))) {
      throw new Error('host inspection plan does not match bound provider, host or read-only policy');
    }
  }

  async function inspect(signal) {
    if (signal?.aborted) throw new Error('host inspection aborted');
    const report = await lifecycleProvider.inspect(provider);
    if (signal?.aborted) throw new Error('host inspection aborted');
    return summarize(report, expectedTarget, expectedProviderId);
  }

  return Object.freeze({
    async execute(context) {
      validateInvocation(context, context?.step);
      return inspect(context.signal);
    },
    async verify(context) {
      validateInvocation(context);
      const evidence = context.checkpoint?.evidence;
      if (!evidence || evidence.schemaVersion !== 1 ||
          !FINGERPRINT_PATTERN.test(evidence.inspectionHash) ||
          !Number.isSafeInteger(evidence.installedCount) || evidence.installedCount < 0 ||
          !Number.isSafeInteger(evidence.resourceCount) || evidence.resourceCount < 0) return false;
      const observed = await inspect(context.signal);
      return observed.inspectionHash === evidence.inspectionHash &&
        observed.installedCount === evidence.installedCount &&
        observed.resourceCount === evidence.resourceCount;
    }
  });
}

module.exports = Object.freeze({
  KIND, STEP_ID, planHostInspection, createHostInspectionExecutor
});
