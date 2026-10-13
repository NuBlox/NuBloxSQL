'use strict';
const assert = require('node:assert/strict');
const sql = require('..');

function client(dialect, handler) {
  const calls = [];
  return {
    dialect, calls,
    async all(statement, operation) {
      assert.match(statement, /^SELECT\s/i);
      assert.doesNotMatch(statement, /DEFINER|EVENT_DEFINITION|owner_sid|sysjobsteps|hist\.message|hist\.step_name/i);
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
  assert.equal(result.jobs[0].operational,undefined,'no new fields unless requested');
  assert.ok(Object.isFrozen(result.jobs[0]));
  assert.ok(Object.isFrozen(result.summary));
  assert.match(db.calls[0].statement,/LIMIT 3$/);
  assert.doesNotMatch(db.calls[0].statement,/LAST_EXECUTED|INTERVAL_VALUE/i);
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
  assert.equal(report.jobs[0].operational,undefined);
  assert.equal(report.summary.truncated,false);
  assert.match(db.calls[0].statement,/^SELECT TOP \(3\).*msdb.dbo.sysjobs/);
  assert.doesNotMatch(db.calls[0].statement,/sysjobhistory|sysjobschedules/);
  await assert.rejects(sql.discoverNativeDatabaseJobs(client('sqlserver',()=>[
    {job_id:'id',job_name:'test',job_enabled:2}
  ])),/enabled value/);
}

async function mysqlOperational() {
  const db=client('mysql',()=>[
    {
      schema_name:'app',event_name:'nightly',event_status:'ENABLED',event_type:'RECURRING',
      event_time_zone:'Europe/London',last_executed_local:'2026-10-13 14:03:02',
      execute_at_local:null,starts_local:'2026-10-01 00:00:00',ends_local:null,
      interval_value:'1',interval_field:'DAY',
      definer:'admin@host',event_definition:'DELETE FROM secret_table'
    },
    {
      schema_name:'app',event_name:'once',event_status:'DISABLED',event_type:'ONE TIME',
      event_time_zone:'UTC',last_executed_local:null,
      execute_at_local:'2026-12-01 01:02:03',starts_local:null,ends_local:null,
      interval_value:null,interval_field:null
    }
  ]);
  const report=await sql.discoverNativeDatabaseJobs(db,{includeOperational:true,operation:{timeout:150}});
  const one=report.jobs[0].operational,once=report.jobs[1].operational;
  assert.match(db.calls[0].statement,/DATE_FORMAT\(LAST_EXECUTED/);
  assert.match(db.calls[0].statement,/INTERVAL_FIELD/);
  assert.match(report.limitation,/does not report success\/failure/);
  assert.equal(one.outcome,'not-reported');
  assert.equal(one.lastExecutedLocal,'2026-10-13 14:03:02');
  assert.equal(one.schedule.intervalField,'DAY');
  assert.equal(one.schedule.intervalValue,'1');
  assert.equal(once.schedule.executeAtLocal,'2026-12-01 01:02:03');
  assert.equal(once.lastExecutedLocal,null);
  assert.ok(Object.isFrozen(one.schedule));
  assert.equal(db.calls[0].operation.timeout,150);
  assert.ok(!JSON.stringify(report).includes('admin@host'));
  assert.ok(!JSON.stringify(report).includes('DELETE FROM'));
  const zero=await sql.discoverNativeDatabaseJobs(client('mysql',()=>[
    {schema_name:'s',event_name:'e',event_status:'ENABLED',event_type:'RECURRING',
      event_time_zone:'SYSTEM',last_executed_local:'0000-00-00 00:00:00',starts_local:null,
      execute_at_local:null,ends_local:null,interval_value:2,interval_field:'HOUR'}
  ]),{includeOperational:true});
  assert.equal(zero.jobs[0].operational.lastExecutedLocal,null);
  assert.equal(zero.jobs[0].operational.schedule.intervalValue,'2');
}

function sqlServerRow(overrides = {}) {
  return {
    job_id:'11111111-1111-1111-1111-111111111111',job_name:'nightly',
    job_enabled:1,schedule_count:2,next_run_packed:20261102013000,
    last_run_status:0,last_run_date:20261013,last_run_time:120102,
    last_run_duration:250203,
    message:'PASSWORD=secret',step_name:'sensitive-job-command',
    ...overrides
  };
}

async function sqlServerOperational() {
  const db=client('sqlserver',()=>[sqlServerRow(),
    sqlServerRow({job_id:'22222222-2222-2222-2222-222222222222',job_name:'never',
      schedule_count:0,next_run_packed:null,last_run_status:null,last_run_date:null,
      last_run_time:null,last_run_duration:null})]);
  const report=await sql.discoverNativeDatabaseJobs(db,{maxRows:3,includeOperational:true});
  const first=report.jobs[0].operational;
  assert.equal(first.lastRun.outcome,'failed');
  assert.equal(first.lastRun.startedLocal,'2026-10-13 12:01:02');
  assert.equal(first.lastRun.durationSeconds,25*3600+2*60+3);
  assert.equal(first.scheduleCount,2);
  assert.equal(first.nextRunLocal,'2026-11-02 01:30:00');
  assert.equal(first.nextRunMayBeStale,true);
  assert.equal(first.runningStateReliable,false);
  assert.equal(report.jobs[1].operational.lastRun,null);
  assert.equal(report.jobs[1].operational.nextRunLocal,null);
  assert.match(db.calls[0].statement,/hist\.step_id = 0/);
  assert.match(db.calls[0].statement,/ORDER BY hist\.instance_id DESC/);
  assert.match(db.calls[0].statement,/sysjobschedules/);
  assert.match(report.limitation,/20 minutes/);
  assert.ok(Object.isFrozen(first.lastRun));
  assert.ok(!JSON.stringify(report).includes('PASSWORD=secret'));
  for(const [status,expected] of [[1,'succeeded'],[2,'retry'],[3,'canceled'],[4,'in-progress']]) {
    const result=await sql.discoverNativeDatabaseJobs(client('sqlserver',()=>[
      sqlServerRow({last_run_status:status})
    ]),{includeOperational:true});
    assert.equal(result.jobs[0].operational.lastRun.outcome,expected);
  }
}

async function badOperationalMetadata() {
  const mysqlBase={
    schema_name:'app',event_name:'bad',event_status:'ENABLED',event_type:'RECURRING',
    event_time_zone:'UTC',last_executed_local:null,starts_local:null,ends_local:null,
    execute_at_local:null,interval_value:'1',interval_field:'DAY'
  };
  for(const value of ['2026-02-30 14:01:02','2026-10-13T14:00:00Z',123]) {
    await assert.rejects(sql.discoverNativeDatabaseJobs(client('mysql',()=>[
      {...mysqlBase,last_executed_local:value}
    ]),{includeOperational:true}),/MySQL last executed/);
  }
  await assert.rejects(sql.discoverNativeDatabaseJobs(client('mysql',()=>[
    {...mysqlBase,interval_field:'DAY; DROP TABLE x'}
  ]),{includeOperational:true}),/interval field/);
  for(const mutation of [
    {last_run_status:5},{last_run_status:-1},{last_run_status:null},
    {last_run_time:246060},{last_run_date:20260230},{last_run_duration:250299},
    {schedule_count:-1},{next_run_packed:20261301120000}
  ]) {
    await assert.rejects(sql.discoverNativeDatabaseJobs(client('sqlserver',()=>[
      sqlServerRow(mutation)
    ]),{includeOperational:true}));
  }
  await assert.rejects(sql.discoverNativeDatabaseJobs(
    client('sqlserver',()=>{throw Error('msdb history permission denied');}),
    {includeOperational:true}
  ),/msdb history permission denied/);
}

async function engineHonesty() {
  for (const [dialect,visibility] of [['pg','not-inspected'],['sqlite','not-applicable']]) {
    const db=client(dialect,()=>{throw Error('no native job query permitted');});
    const report=await sql.discoverNativeDatabaseJobs(db,{includeOperational:true});
    assert.equal(report.visibility,visibility);
    assert.equal(report.jobs.length,0);
    assert.equal(report.complete,false);
    assert.equal(db.calls.length,0);
  }
  const live=sql.createClient({dialect:'sqlite',filename:':memory:'});
  try {
    const report=await live.discoverNativeJobs({includeOperational:true});
    assert.equal(report.visibility,'not-applicable');
    assert.equal(report.jobs.length,0);
  } finally {await live.close();}
}

async function inputAndFailureBoundaries() {
  for (const bad of [0,1001,1.2,-1,NaN,'5',null]) {
    await assert.rejects(sql.discoverNativeDatabaseJobs(client('sqlite',()=>[]),{maxRows:bad}),/maxRows/);
  }
  for(const bad of [null,1,'true',{},[]]) {
    await assert.rejects(sql.discoverNativeDatabaseJobs(
      client('sqlite',()=>[]),{includeOperational:bad}),/includeOperational/);
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
  await mysql(); await sqlserver();
  await mysqlOperational(); await sqlServerOperational(); await badOperationalMetadata();
  await engineHonesty(); await inputAndFailureBoundaries();
  console.log('NuBloxSQL native job discovery and optional operational visibility contract: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
