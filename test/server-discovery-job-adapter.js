'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const jobs = require('../lib/jobs/JobKernel');
const { createWorker } = require('../lib/jobs/JobWorker');
const { createStore } = require('../lib/jobs/SqliteJobStore');
const adapter = require('../lib/jobs/ServerDiscoveryJobAdapter');

async function withStore(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nublox-discovery-job-'));
  const store = createStore({ filename: path.join(dir, 'job-store.sqlite') });
  try { return await fn(store); }
  finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

async function submit(store, plan, id) {
  const kernel = jobs.createKernel(store);
  await kernel.submit(plan, {runId:id});
  return kernel.advance(id, 0, 'queued');
}

function fakeClient(dialect, options = {}) {
  const queried = [];
  let databaseNames = ['app', 'audit'];
  const client = {
    dialect,
    queried,
    setDatabases(value) { databaseNames = value.slice(); },
    async all(statement) {
      queried.push(statement);
      const isIdentity = /^(SELECT.*(?:VERSION\(|server_version|SERVERPROPERTY|sqlite_version))/i.test(statement);
      if (isIdentity) {
        return [{
          version: '1.2.3', current_database:'app', current_user:'operator',
          edition:'test', server_name:'example'
        }];
      }
      if (/^PRAGMA database_list/i.test(statement)) {
        return databaseNames.map((name, seq) => ({seq, name, file: ':memory:'}));
      }
      return databaseNames.map(name => ({
        name, accessible:true, is_template:false, state_desc:'ONLINE'
      }));
    },
    async execute() { throw new Error('read-only adapter must never execute SQL mutations'); }
  };
  return client;
}

async function runOne(store, client, targetIdentity, runId, registry, expectedStatus = 'succeeded') {
  const plan = adapter.planServerDiscovery({targetIdentity, dialect:client.dialect});
  await submit(store, plan, runId);
  const useRegistry = registry || jobs.createExecutorRegistry();
  if (!registry) useRegistry.register(adapter.KIND, adapter.createServerDiscoveryExecutor({client,targetIdentity}));
  const worker = createWorker({store, registry:useRegistry, workerId:'inspect-'+runId});
  const result = await worker.runOnce();
  assert.equal(result.status, expectedStatus);
  assert.equal(store.getRun(runId).status, expectedStatus);
  return { plan, result, run:store.getRun(runId) };
}

async function qualifiedFourDialectDiscovery() {
  await withStore(async store => {
    for (const dialect of adapter.DIALECTS) {
      const client=fakeClient(dialect);
      const targetIdentity='server-'+dialect;
      const {plan, run} = await runOne(store,client,targetIdentity,'run-'+dialect);
      assert.equal(plan.policy.readOnly,true);
      assert.equal(run.checkpoint.evidence.databaseCount,2);
      assert.match(run.checkpoint.evidence.fingerprint,/^[a-f0-9]{64}$/);
      assert.equal(client.queried.length,4,'two real domain discovery reads (identity and catalog) per run');
      assert.ok(client.queried.every(s=>/^(SELECT|PRAGMA)/i.test(s)));
      const output=JSON.stringify({plan,checkpoint:run.checkpoint,events:store.listEvents(run.runId)});
      assert.ok(!output.includes('operator'),'no user identity persisted');
      assert.ok(!output.includes('audit'),'no raw database catalogue persisted');
    }
  });
}

async function realSqliteDiscovery() {
  await withStore(async store => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec('CREATE TABLE actual_table (id INTEGER PRIMARY KEY, value TEXT)');
      const statements=[];
      const client={
        dialect:'sqlite',
        async all(statement){
          assert.match(statement,/^(SELECT|PRAGMA)/i);
          statements.push(statement);
          return database.prepare(statement).all();
        },
        execute(){throw new Error('mutation forbidden');}
      };
      const {run}=await runOne(store,client,'sqlite-live-test','real-sqlite');
      assert.equal(run.checkpoint.evidence.databaseCount,1);
      assert.equal(statements.length,4);
      assert.equal(run.reason,'post-execution-verified');
    } finally { database.close(); }
  });
}

async function driftAndPlanBinding() {
  await withStore(async store => {
    const client = fakeClient('postgresql');
    let calls=0;
    const original=client.all;
    client.all=async function(statement){
      calls++;
      if (calls===3) client.setDatabases(['app','audit','new_database']);
      return original.call(client,statement);
    };
    const {run}=await runOne(store,client,'postgresql-primary','drifting',undefined,'blocked');
    assert.equal(run.reason,'post-execution-verification-unconfirmed');
    assert.equal(run.checkpoint.evidence.databaseCount,2);
  });

  await withStore(async store => {
    const client=fakeClient('mysql');
    const plan=adapter.planServerDiscovery({dialect:'mysql',targetIdentity:'server-a'});
    await submit(store,plan,'target-mismatch');
    const registry=jobs.createExecutorRegistry();
    registry.register(adapter.KIND,adapter.createServerDiscoveryExecutor({client,targetIdentity:'server-b'}));
    const worker=createWorker({store,registry,workerId:'mismatch'});
    assert.equal((await worker.runOnce()).status,'blocked');
    assert.equal(client.queried.length,0);
    assert.equal(store.getRun('target-mismatch').reason,'execution-outcome-unconfirmed');
  });
}

async function validationAndSecrets() {
  assert.throws(()=>adapter.planServerDiscovery({dialect:'oracle',targetIdentity:'host'}),/unsupported/);
  assert.throws(()=>adapter.planServerDiscovery({dialect:'mysql',targetIdentity:'mysql:\/\/admin:secret@host'}),/credential-free/);
  assert.throws(()=>adapter.createServerDiscoveryExecutor({targetIdentity:'one',client:{dialect:'sqlite'}}),/connected/);
  const pg=adapter.planServerDiscovery({dialect:'pg',targetIdentity:'server_1'});
  assert.equal(pg.dialect,'postgresql');
  const sqlServer=adapter.planServerDiscovery({dialect:'mssql',targetIdentity:'server_1'});
  assert.equal(sqlServer.dialect,'sqlserver');
  assert.equal(Object.isFrozen(pg.steps[0]),true);
  assert.ok(!JSON.stringify(pg).includes('password'));
}

(async()=>{
  await qualifiedFourDialectDiscovery();
  await realSqliteDiscovery();
  await driftAndPlanBinding();
  await validationAndSecrets();
  console.log('NuBloxSQL four-dialect read-only discovery job adapter: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
