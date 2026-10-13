'use strict';
const assert = require('node:assert/strict');
const sql = require('..');

function client(dialect, handler) {
  const calls = [];
  return {
    dialect, calls,
    async all(statement, operation) {
      assert.match(statement, /^SELECT\s/i);
      assert.doesNotMatch(statement, /DEFINER|EVENT_DEFINITION|owner_sid|sysjobsteps|sysjobhistory/i);
      calls.push({ statement, operation });
      return handler(statement, operation);
    }
  };
}

async function mysql() {
  const db = client('mysql', () => [
    {schema_name:'app', event_name:'nightly', event_status:'ENABLED',event_type:'RECURRING',event_time_zone:'UTC'},
    {schema_name:'app', event_name:'oneoff', event_status:'DISABLED',event_type:'ONE TIME',event_time_zone:'SYSTEM'},
    {schema_name:'other', event_name:'extra', event_status:'SLAVESIDE_DISABLED',event_type:'RECURRING',event_time_zone:'UTC'}
  ]);
  const result = await sql.discoverNativeDatabaseJobs(db,{maxRows:2,operation:{timeout:200}});
  assert.equal(result.schemaVersion,1);
  assert.equal(result.system,'mysql-event-scheduler');
  assert.equal(result.visibility,'permission-scoped');
  assert.equal(result.complete,false);
  assert.equal(result.jobs.length,2);
  assert.equal(result.summary.truncated,true);
  assert.equal(result.jobs[0].schema,'app');
  assert.equal(result.jobs[0].enabled,true);
  assert.equal(result.jobs[1].enabled,false);
  assert.ok(Object.isFrozen(result.jobs[0]));
  assert.ok(Object.isFrozen(result.summary));
  assert.match(db.calls[0].statement,/LIMIT 3$/);
  assert.equal(db.calls[0].operation.timeout,200);
  assert.ok(!JSON.stringify(result).includes('DEFINER'));
  await assert.rejects(sql.discoverNativeDatabaseJobs(client('mysql',()=>[
    {schema_name:'app',event_name:'bad',event_status:'bogus',event_type:'RECURRING',event_time_zone:'UTC'}
  ])),/unsupported MySQL event status/);
}

async function sqlserver() {
  const db=client('mssql',()=>[
    {job_id:'11111111-1111-1111-1111-111111111111',job_name:'daily',job_enabled:1},
    {job_id:'22222222-2222-2222-2222-222222222222',job_name:'paused',job_enabled:0}
  ]);
  const report=await sql.discoverNativeDatabaseJobs(db,{maxRows:2});
  assert.equal(report.dialect,'sqlserver');
  assert.equal(report.system,'sqlserver-agent');
  assert.equal(report.jobs.length,2);
  assert.equal(report.jobs[0].enabled,true);
  assert.equal(report.jobs[1].enabled,false);
  assert.equal(report.jobs[0].kind,'sqlserver-agent-job');
  assert.equal(report.summary.truncated,false);
  assert.match(db.calls[0].statement,/^SELECT TOP \(3\).*msdb.dbo.sysjobs/);
  await assert.rejects(sql.discoverNativeDatabaseJobs(client('sqlserver',()=>[
    {job_id:'id',job_name:'test',job_enabled:2}
  ])),/enabled value/);
}

async function engineHonesty() {
  for (const [dialect,visibility] of [['pg','not-inspected'],['sqlite','not-applicable']]) {
    const db=client(dialect,()=>{throw Error('no native job query permitted');});
    const report=await sql.discoverNativeDatabaseJobs(db);
    assert.equal(report.visibility,visibility);
    assert.equal(report.jobs.length,0);
    assert.equal(report.complete,false);
    assert.equal(db.calls.length,0);
  }
  const live=sql.createClient({dialect:'sqlite',filename:':memory:'});
  try {
    const report=await live.discoverNativeJobs();
    assert.equal(report.visibility,'not-applicable');
    assert.equal(report.jobs.length,0);
  } finally {await live.close();}
}

async function inputAndFailureBoundaries() {
  for (const bad of [0,1001,1.2,-1,NaN,'5',null]) {
    await assert.rejects(sql.discoverNativeDatabaseJobs(client('sqlite',()=>[]),{maxRows:bad}),/maxRows/);
  }
  await assert.rejects(sql.discoverNativeDatabaseJobs(client('mysql',()=>[]),{operation:null}),/operation/);
  await assert.rejects(sql.discoverNativeDatabaseJobs(client('mysql',()=>null)),/row array/);
  await assert.rejects(sql.discoverNativeDatabaseJobs({dialect:'oracle',all:async()=>[]}),/unsupported/);
  await assert.rejects(sql.discoverNativeDatabaseJobs({dialect:'mysql'}),/client/);
  await assert.rejects(sql.discoverNativeDatabaseJobs(client('sqlserver',()=>{throw Error('msdb permission denied');})),/msdb permission denied/);
  const redacted=await sql.discoverNativeDatabaseJobs(client('mysql',()=>[
    {schema_name:'app',event_name:'nightly',event_status:'ENABLED',event_type:'RECURRING',
      event_time_zone:'UTC',definer:'admin@host',event_definition:'DELETE FROM secrets'}
  ]));
  assert.ok(!JSON.stringify(redacted).includes('admin@host'));
  assert.ok(!JSON.stringify(redacted).includes('DELETE FROM'));
}

(async()=>{
  await mysql(); await sqlserver(); await engineHonesty(); await inputAndFailureBoundaries();
  console.log('NuBloxSQL engine-native read-only job discovery contract: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
