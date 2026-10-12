'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { createPlan, createExecutorRegistry } = require('../lib/jobs/JobKernel');
const { createApprovalPolicy } = require('../lib/jobs/JobApprovalPolicy');
const { createWorker } = require('../lib/jobs/JobWorker');
const { createStore } = require('../lib/jobs/SqliteJobStore');
const schedule = require('../lib/jobs/JobSchedule');

const START = Date.parse('2026-10-12T10:00:00.000Z');
const policy = createApprovalPolicy();

function plan(kind = 'inspection.host', approvalRequired = false) {
  return createPlan({
    jobKind:kind, lifecyclePhase:'Discover',targetIdentity:'local-host:fixture',
    policy:{approvalRequired,readOnly:!approvalRequired,hostMutation:false},
    steps:[{stepId:'inspect'}]
  });
}

function registry() {
  const r=createExecutorRegistry();
  r.register('inspection.host',{
    retrySafe:true,
    async execute(){return {inspectionHash:'abc'};},
    async verify(){return true;}
  });
  return r;
}

async function fixture(test) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nublox-scheduler-'));
  const filename=path.join(dir,'jobs.sqlite');
  let now=START;
  let store;
  const open=()=>createStore({filename,clock:()=>now});
  try{
    store=open();
    await test({
      filename,open,registry:registry(),get store(){return store;},
      reopen(){store.close();store=open();return store;},
      now(value){now=value;},
      get time(){return now;}
    });
  }finally{
    if(store)store.close();
    fs.rmSync(dir,{recursive:true,force:true});
  }
}

function create(ctx,id,overrides={}) {
  return ctx.store.createSchedule({
    scheduleId:id, plan:plan(), approvalPolicy:policy, registry:ctx.registry,
    recurrence:{kind:'interval',everyMinutes:1,
      anchorAt:new Date(START).toISOString()},
    ...overrides
  });
}

async function recurrenceAndDST() {
  assert.equal(schedule.nextAfter({
    kind:'daily',at:'01:30',timeZone:'Europe/London'
  },Date.parse('2026-10-25T00:00:00Z')),Date.parse('2026-10-25T00:30:00Z'));
  // The 01:30 local time occurs twice on fall-back day; exactly one run.
  assert.equal(schedule.nextAfter({
    kind:'daily',at:'01:30',timeZone:'Europe/London'
  },Date.parse('2026-10-25T00:31:00Z')),Date.parse('2026-10-26T01:30:00Z'));
  assert.equal(schedule.previousAtOrBefore({
    kind:'daily',at:'01:30',timeZone:'Europe/London'
  },Date.parse('2026-10-25T01:31:00Z')),Date.parse('2026-10-25T00:30:00Z'));
  // Missing spring-forward local time is skipped, not silently shifted.
  assert.equal(schedule.nextAfter({
    kind:'daily',at:'01:30',timeZone:'Europe/London'
  },Date.parse('2026-03-29T00:31:00Z')),Date.parse('2026-03-30T00:30:00Z'));
  assert.equal(schedule.nextAfter({
    kind:'daily',at:'09:15',timeZone:'Europe/London'
  },Date.parse('2026-10-12T08:15:00Z')),Date.parse('2026-10-13T08:15:00Z'));
  assert.equal(schedule.nextAfter({
    kind:'interval',everyMinutes:15,anchorAt:'2026-10-12T10:00:00.000Z'
  },START),START+900000);
  assert.throws(()=>schedule.validate({kind:'daily',at:'25:45',timeZone:'Europe/London'}),/HH:MM/);
  assert.throws(()=>schedule.validate({kind:'daily',at:'10:00',timeZone:'Mars/Olympus'}),/IANA/);
  assert.throws(()=>schedule.validate({kind:'interval',everyMinutes:0,anchorAt:'2026-10-12T10:00:00.000Z'}),/everyMinutes/);
  assert.throws(()=>schedule.validate({kind:'interval',everyMinutes:1,anchorAt:'2026-10-12T10:00:00.000Z',password:'x'}),/secret-bearing/);
}

async function dispatchAndWorker() {
  await fixture(async ctx=>{
    create(ctx,'one');
    const dispatch=ctx.store.dispatchDueSchedules({approvalPolicy:policy,registry:ctx.registry});
    assert.equal(dispatch.length,1);
    assert.equal(dispatch[0].status,'queued');
    assert.equal(dispatch[0].scheduledFor,'2026-10-12T10:00:00.000Z');
    const job=ctx.store.getRun(dispatch[0].runId);
    assert.equal(job.trigger.scheduleId,'one');
    assert.equal(job.trigger.type,'schedule');
    assert.equal(job.requestedBy,'scheduler:one');
    assert.deepEqual(ctx.store.listEvents(job.runId).map(x=>x.type),['planned','status']);
    assert.equal(ctx.store.listScheduleEvents('one').at(-1).type,'run-queued');
    assert.deepEqual(ctx.store.dispatchDueSchedules({approvalPolicy:policy,registry:ctx.registry}),[]);
    ctx.reopen();
    assert.equal(ctx.store.getSchedule('one').nextDueAt,'2026-10-12T10:01:00.000Z');
    assert.equal(ctx.store.getRun(dispatch[0].runId).status,'queued');
    const worker=createWorker({
      store:ctx.store,registry:ctx.registry,workerId:'scheduler-test-worker',
      clock:()=>ctx.time
    });
    assert.equal((await worker.runOnce()).status,'succeeded');
    assert.equal(ctx.store.getRun(dispatch[0].runId).status,'succeeded');
    ctx.now(START+60000);
    assert.equal(ctx.store.dispatchDueSchedules({approvalPolicy:policy,registry:ctx.registry})[0].status,'queued');
  });
}

async function misfiresAndOverlaps() {
  await fixture(async ctx=>{
    create(ctx,'overlap');
    const first=ctx.store.dispatchDueSchedules({approvalPolicy:policy,registry:ctx.registry})[0];
    assert.equal(first.status,'queued');
    ctx.now(START+60000);
    assert.deepEqual(ctx.store.dispatchDueSchedules({approvalPolicy:policy,registry:ctx.registry}),[{
      scheduleId:'overlap',status:'skipped',reason:'overlap-forbidden'
    }]);
    assert.equal(ctx.store.getSchedule('overlap').nextDueAt,'2026-10-12T10:02:00.000Z');
    assert.equal(ctx.store.getRun(first.runId).status,'queued');

    create(ctx,'stale',{recurrence:{kind:'interval',everyMinutes:1,
      anchorAt:new Date(START).toISOString()},maxLatenessMs:1000});
    ctx.now(START+125000);
    assert.deepEqual(ctx.store.dispatchDueSchedules({approvalPolicy:policy,registry:ctx.registry})
      .find(x=>x.scheduleId==='stale'),{
      scheduleId:'stale',status:'skipped',reason:'misfire-too-late'
    });
    assert.equal(ctx.store.getSchedule('stale').nextDueAt,'2026-10-12T10:03:00.000Z');
    assert.equal(ctx.store.listScheduleEvents('stale').at(-1).type,'schedule-skipped');

    create(ctx,'latest',{misfirePolicy:'latest',maxLatenessMs:30000});
    ctx.now(START+245000);
    const last=ctx.store.dispatchDueSchedules({approvalPolicy:policy,registry:ctx.registry})
      .find(x=>x.scheduleId==='latest');
    assert.equal(last.status,'queued');
    assert.equal(last.scheduledFor,'2026-10-12T10:04:00.000Z');
    assert.equal(ctx.store.getSchedule('latest').nextDueAt,'2026-10-12T10:05:00.000Z');
  });
}

async function denialAndDisable() {
  await fixture(async ctx=>{
    assert.throws(()=>create(ctx,'mutation',{plan:plan('administration.bootstrap',true)}),/read-only/);
    assert.throws(()=>create(ctx,'bad-misfire',{misfirePolicy:'catch-up'}),/misfirePolicy/);
    assert.throws(()=>create(ctx,'bad-overlap',{overlapPolicy:'replace'}),/overlapPolicy/);
    assert.throws(()=>create(ctx,'bad-limit',{maxLatenessMs:-1}),/maxLatenessMs/);
    create(ctx,'switch');
    assert.equal(ctx.store.setScheduleEnabled('switch',false).enabled,false);
    assert.deepEqual(ctx.store.dispatchDueSchedules({approvalPolicy:policy,registry:ctx.registry}),[]);
    ctx.now(START+60000);
    assert.equal(ctx.store.setScheduleEnabled('switch',true).nextDueAt,'2026-10-12T10:01:00.000Z');
    const hostileRegistry=createExecutorRegistry();
    assert.deepEqual(ctx.store.dispatchDueSchedules({approvalPolicy:policy,registry:hostileRegistry}),
      [{scheduleId:'switch',status:'disabled'}]);
    assert.equal(ctx.store.getSchedule('switch').enabled,false);
    assert.equal(ctx.store.listScheduleEvents('switch').at(-1).reason,'qualification-lost');
  });
}

function dispatchFromProcess(filename,runId) {
  return new Promise((resolve,reject)=>{
    const child=childProcess.spawn(process.execPath,
      [path.join(__dirname,'fixtures','scheduler-dispatch-worker.js'),filename,String(START),runId],
      {stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    child.stdout.on('data',chunk=>stdout+=chunk);
    child.stderr.on('data',chunk=>stderr+=chunk);
    child.on('error',reject);
    child.on('close',code=>{
      if(code!==0)return reject(new Error('scheduler process failed: '+stderr));
      try{resolve(JSON.parse(stdout));}catch(error){reject(error);}
    });
  });
}

async function concurrentDispatch() {
  await fixture(async ctx=>{
    create(ctx,'multi-process');
    ctx.store.close();
    const claims=await Promise.all([
      dispatchFromProcess(ctx.filename,'one'),
      dispatchFromProcess(ctx.filename,'two')
    ]);
    assert.equal(claims.flat().filter(x=>x.status==='queued').length,1);
    const reopened=ctx.open();
    try {
      assert.equal(reopened.listSchedules().length,1);
      assert.equal(reopened.getSchedule('multi-process').nextDueAt,
        '2026-10-12T10:01:00.000Z');
    } finally { reopened.close(); }
    // Replace closed fixture handle so its cleanup is idempotent.
    ctx.reopen();
  });
}

async function upgradeFromV3() {
  await fixture(async ctx=>{
    create(ctx,'historic');
    ctx.store.close();
    const db=new DatabaseSync(ctx.filename);
    db.exec('DROP TABLE job_schedule_events; DROP TABLE job_schedule_occurrences; DROP TABLE job_schedules; PRAGMA user_version = 3');
    db.close();
    ctx.reopen();
    assert.equal(ctx.store.schemaVersion,4);
    assert.equal(ctx.store.listSchedules().length,0);
  });
}

(async()=>{
  await recurrenceAndDST();
  await dispatchAndWorker();
  await misfiresAndOverlaps();
  await denialAndDisable();
  await concurrentDispatch();
  await upgradeFromV3();
  console.log('NuBloxSQL durable read-only scheduler contract: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
