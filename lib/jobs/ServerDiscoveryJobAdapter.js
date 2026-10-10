'use strict';

// Internal, explicitly read-only adapter for the existing NuBloxSQL server discovery API.
// Credentials and live clients stay in process memory, never in the immutable job plan.

const crypto = require('node:crypto');
const discoveryApi = require('../client/DatabaseServerDiscovery');
const jobs = require('./JobKernel');

const KIND = 'discovery.server';
const STEP_ID = 'discover-server';
const DIALECTS = Object.freeze(['mysql', 'postgresql', 'sqlite', 'sqlserver']);

function dialectName(input) {
  if (typeof input !== 'string') throw new TypeError('discovery dialect must be a string');
  let value = input.trim().toLowerCase();
  if (value === 'postgres' || value === 'pg') value = 'postgresql';
  if (value === 'mssql' || value === 'sql-server') value = 'sqlserver';
  if (!DIALECTS.includes(value)) throw new RangeError('unsupported discovery dialect: ' + input);
  return value;
}

function targetName(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(value)) {
    throw new TypeError('targetIdentity must be a credential-free opaque identifier (1-128 characters)');
  }
  return value;
}

function planServerDiscovery(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('server discovery input must be an object');
  const targetIdentity = targetName(input.targetIdentity);
  const dialect = dialectName(input.dialect);
  return jobs.createPlan({
    jobKind: KIND,
    lifecyclePhase: 'Discover',
    targetIdentity,
    dialect,
    policy: { approvalRequired: false, readOnly: true },
    steps: [{ stepId: STEP_ID }]
  });
}

function fingerprint(report, expectedDialect) {
  if (!report || report.schemaVersion !== discoveryApi.SCHEMA_VERSION ||
      report.dialect !== expectedDialect || !report.identity || !Array.isArray(report.databases)) {
    throw new TypeError('invalid NuBloxSQL server discovery evidence');
  }
  const i = report.identity;
  // Never persist native rows, user names, database names or connection information.
  const catalogue = report.databases.map(db => {
    if (!db || typeof db.name !== 'string' || !['database', 'template', 'attached-database'].includes(db.kind) ||
        ![true, false, null].includes(db.accessible)) {
      throw new TypeError('invalid discovered database evidence');
    }
    return [db.name, db.kind, db.accessible];
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const projected = {
    dialect: report.dialect,
    identity: [i.product, i.version, i.edition, i.serverName, i.currentDatabase, i.currentUser],
    catalogue
  };
  return Object.freeze({
    schemaVersion: 1,
    dialect: expectedDialect,
    fingerprint: crypto.createHash('sha256').update(JSON.stringify(projected)).digest('hex'),
    databaseCount: catalogue.length
  });
}

function createServerDiscoveryExecutor(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('server discovery executor options must be an object');
  }
  const targetIdentity = targetName(options.targetIdentity);
  const client = options.client;
  if (!client || typeof client !== 'object' || typeof client.all !== 'function') {
    throw new TypeError('server discovery executor requires a connected NuBloxSQL client');
  }
  const dialect = dialectName(client.dialect);

  function validateInvocation({ plan, signal }, step) {
    if (signal && signal.aborted) throw new Error('server discovery aborted');
    if (!plan || plan.jobKind !== KIND || plan.lifecyclePhase !== 'Discover' ||
        plan.targetIdentity !== targetIdentity || plan.dialect !== dialect ||
        !plan.policy || plan.policy.approvalRequired !== false ||
        plan.policy.readOnly !== true ||
        !Array.isArray(plan.steps) || plan.steps.length !== 1 ||
        plan.steps[0].stepId !== STEP_ID ||
        (step !== undefined && (!step || step.stepId !== STEP_ID))) {
      throw new Error('server discovery plan does not match bound client/target or read-only contract');
    }
  }

  async function inspect(signal) {
    if (signal && signal.aborted) throw new Error('server discovery aborted');
    // The existing domain API issues only identity SELECT and catalogue SELECT/PRAGMA reads.
    const report = await discoveryApi.discover(client);
    if (signal && signal.aborted) throw new Error('server discovery aborted');
    return fingerprint(report, dialect);
  }

  return Object.freeze({
    async execute(context) {
      if (!context || typeof context !== 'object') throw new TypeError('job execution context required');
      validateInvocation(context, context.step);
      return inspect(context.signal);
    },
    async verify(context) {
      if (!context || typeof context !== 'object') throw new TypeError('job verification context required');
      validateInvocation(context);
      const evidence = context.checkpoint && context.checkpoint.evidence;
      if (!evidence || evidence.schemaVersion !== 1 || evidence.dialect !== dialect ||
          typeof evidence.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(evidence.fingerprint) ||
          !Number.isSafeInteger(evidence.databaseCount) || evidence.databaseCount < 0) return false;
      const observed = await inspect(context.signal);
      return observed.fingerprint === evidence.fingerprint &&
        observed.databaseCount === evidence.databaseCount;
    }
  });
}

module.exports = Object.freeze({
  KIND, STEP_ID, DIALECTS, planServerDiscovery, createServerDiscoveryExecutor
});
