'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jobs = require('../lib/jobs/JobKernel');
const { createStore } = require('../lib/jobs/SqliteJobStore');
const { createWorker } = require('../lib/jobs/JobWorker');
const adapter = require('../lib/jobs/HostInspectionJobAdapter');

async function withStore(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nublox-host-inspection-'));
  const store = createStore({ filename: path.join(directory, 'jobs.sqlite') });
  try { await callback(store); }
  finally { store.close(); fs.rmSync(directory, { recursive: true, force: true }); }
}

function providerFixture(overrides = {}) {
  const observed = [];
  const files = new Set(['/private-tenant-database.db']);
  const responses = {
    'postgres --version': 'postgres (PostgreSQL) 18.1',
    'mysqld --version': 'mysqld  Ver 8.4.11 for Linux on x86_64',
    'sqlite3 -version': '3.51.0 2026-09-01',
    'sqlservr -v': '17.0.4085.5',
    'apt-get --version': 'apt 3.0.3',
    'docker --version': 'Docker version 28.0'
  };
  return {
    observed,
    options: {
      system: {
        platform: 'linux',
        architecture: 'x64',
        release: '6.8.0-test',
        hostname: overrides.hostname || 'db-host',
        elevated: false
      },
      commandRunner(executable, args) {
        const key = executable + ' ' + args.join(' ');
        observed.push(key);
        const output = overrides.output ? overrides.output(key, responses[key], observed) : responses[key];
        return output === undefined ?
          {available: false, status: null, stdout: '', stderr:'',error:{code:'ENOENT',message:'not installed'}} :
          {available: true, status: 0, stdout: output + '\n'};
      },
      filesystem: {
        existsSync(name) { return files.has(name); },
        statSync(name) {
          if (!files.has(name)) throw new Error('ENOENT');
          return {isDirectory() { return false; }, isFile() {return true;}};
        },
        readFileSync(name) {
          if (!files.has(name)) throw new Error('ENOENT');
          return Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(48)]);
        }
      },
      resourceHints: [{engine: 'sqlite', kind: 'database-file', path: '/private-tenant-database.db'}]
    }
  };
}

async function queue(store, plan, runId) {
  const kernel = jobs.createKernel(store);
  await kernel.submit(plan, {runId});
  await kernel.advance(runId, 0, 'queued');
}

async function run(store, plan, fixture, adapterTarget, runId) {
  const registry = jobs.createExecutorRegistry();
  registry.register(adapter.KIND, adapter.createHostInspectionExecutor({
    targetIdentity: adapterTarget, providerOptions: fixture.options
  }));
  await queue(store, plan, runId);
  const worker = createWorker({store, registry, workerId: 'host-worker-'+runId});
  return worker.runOnce();
}

async function qualifiedHostInspection() {
  await withStore(async store => {
    const fixture = providerFixture();
    const plan = adapter.planHostInspection({targetIdentity:'local-host:db-host'});
    assert.equal(plan.jobKind,'inspection.host');
    assert.equal(plan.lifecyclePhase,'Discover');
    assert.equal(plan.policy.approvalRequired,false);
    assert.equal(plan.policy.readOnly,true);
    assert.equal(plan.policy.hostMutation,false);
    assert.ok(Object.isFrozen(plan.steps[0]));
    const result = await run(store,plan,fixture,'local-host:db-host','inspect-success');
    assert.deepEqual(result,{runId:'inspect-success',status:'succeeded'});
    const record = store.getRun('inspect-success');
    assert.equal(record.status,'succeeded');
    assert.equal(record.reason,'post-execution-verified');
    assert.equal(record.lease,undefined);
    assert.equal(record.checkpoint.evidence.schemaVersion,1);
    assert.equal(record.checkpoint.evidence.installedCount,4);
    assert.equal(record.checkpoint.evidence.resourceCount,1);
    assert.match(record.checkpoint.evidence.inspectionHash,/^[0-9a-f]{64}$/);
    assert.deepEqual(Object.keys(record.checkpoint.evidence).sort(),
      ['inspectionHash','installedCount','resourceCount','schemaVersion'].sort());
    const persisted = JSON.stringify({
      plan: store.getPlan(plan.planHash),
      run: record,
      events: store.listEvents(record.runId)
    });
    assert.ok(!persisted.includes('/private-tenant-database.db'));
    assert.ok(!persisted.includes('6.8.0-test'));
    assert.ok(!persisted.includes('postgres (PostgreSQL)'));
    assert.ok(fixture.observed.filter(cmd=>cmd==='postgres --version').length===2);
    assert.deepEqual(store.listEvents('inspect-success').map(event=>event.type),
      ['planned','status','leased','status','checkpoint','status','status']);
  });
}

async function driftBlocksConfirmation() {
  await withStore(async store => {
    let scans=0;
    const fixture=providerFixture({
      output(key,base) {
        if (key==='sqlite3 -version') {
          scans++;
          return scans===1 ? '3.51.0 2026-09-01' : '3.52.0 2026-09-02';
        }
        return base;
      }
    });
    const plan=adapter.planHostInspection({targetIdentity:'local-host:db-host'});
    const result=await run(store,plan,fixture,'local-host:db-host','host-drift');
    assert.equal(result.status,'blocked');
    const record=store.getRun('host-drift');
    assert.equal(record.reason,'post-execution-verification-unconfirmed');
    assert.equal(record.checkpoint.evidence.installedCount,4);
    assert.equal(scans,2);
  });
}

async function rejectWrongTargetsBeforeOrAfterProbing() {
  await withStore(async store => {
    const fixture=providerFixture();
    const plan=adapter.planHostInspection({targetIdentity:'local-host:unrelated'});
    const result=await run(store,plan,fixture,'local-host:db-host','wrong-bound-target');
    assert.equal(result.status,'blocked');
    assert.equal(store.getRun('wrong-bound-target').reason,'execution-outcome-unconfirmed');
    assert.equal(fixture.observed.length,0);
  });

  await withStore(async store => {
    const fixture=providerFixture({hostname:'actual-host'});
    const plan=adapter.planHostInspection({targetIdentity:'local-host:expected-host'});
    const result=await run(store,plan,fixture,'local-host:expected-host','wrong-observed-target');
    assert.equal(result.status,'blocked');
    assert.equal(store.getRun('wrong-observed-target').checkpoint,null);
    assert.ok(fixture.observed.length>0);
  });
}

async function validations() {
  assert.throws(()=>adapter.planHostInspection(),/targetIdentity/);
  assert.throws(()=>adapter.planHostInspection({targetIdentity:'ssh://admin:pass@host'}),/credential-free/);
  assert.throws(()=>adapter.planHostInspection({targetIdentity:'local-host:host/subdirectory'}),/credential-free/);
  assert.throws(()=>adapter.planHostInspection({targetIdentity:'local-host:host',providerId:'local-host; rm -rf'}),/providerId/);
  assert.throws(()=>adapter.createHostInspectionExecutor({targetIdentity:'local-host:host',providerOptions:[]}),/providerOptions/);
  assert.throws(()=>adapter.createHostInspectionExecutor({
    targetIdentity:'local-host:host',
    providerOptions:{installedHints:[{engine:'mysql',version:'8.4',native:{password:'raw-secret'}}]}
  }),/secret-like/);
  assert.equal(adapter.createHostInspectionExecutor({
    targetIdentity:'local-host:host',providerOptions:providerFixture().options
  }).verify instanceof Function,true);
  const pkg = require('../package.json');
  assert.ok(!pkg.files.includes('lib/jobs/'),'job adapters remain internal and unshipped');
}

(async function main(){
  await qualifiedHostInspection();
  await driftBlocksConfirmation();
  await rejectWrongTargetsBeforeOrAfterProbing();
  await validations();
  console.log('NuBloxSQL read-only host inspection job adapter: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
