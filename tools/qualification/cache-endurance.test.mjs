import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cacheEnduranceOptions,requestedCacheEnduranceDuration,
  runCacheEndurance} from './cache-endurance.mjs';
import {CACHE_HOT_SQL,CACHE_CHURN_SQL} from './cache-concurrency.mjs';
import {selectCacheEnduranceReport,validateCacheEnduranceEvidence}
  from './cache-endurance-evidence.mjs';

const sha='a'.repeat(40),runId='123456';
const env={GITHUB_EVENT_NAME:'pull_request',NUBLOX_ENDURANCE_MINUTES:'0'};
function fixture({badResult=false,leaveHandles=false,failQuery=false}={}){
  const sessions=new Set();
  let handles=0,maxHandles=0,closed=0;
  async function connect(target){
    assert.equal(target.statementCacheSize,1);
    const state={sql:null,closed:false,queries:0};
    const session={
      async query(sql,params){
        assert.ok(!state.closed&&
          [CACHE_HOT_SQL,CACHE_CHURN_SQL].includes(sql));
        if(state.sql!==sql){
          if(state.sql!==null)handles--;
          handles++;
          maxHandles=Math.max(handles,maxHandles);
          assert.ok(handles<=8,'Server quota must never be exceeded');
          state.sql=sql;
        }
        state.queries++;
        if(failQuery&&state.queries===10)throw Error('fixture SQL error');
        await Promise.resolve();
        return {rows:[{value:BigInt(params[0]+(badResult?1:0))}]};
      },
      async close(){
        if(state.closed)return;
        state.closed=true;closed++;
        if(state.sql&&!leaveHandles)handles--;
        sessions.delete(session);
      }
    };
    sessions.add(session);
    return session;
  }
  return {
    connect,inspect:async()=>handles,
    get connections(){return sessions.size;},
    get maxHandles(){return maxHandles;},
    get closed(){return closed;}
  };
}
const target={security:'verified-tls'};
const options={durationMs:12000,concurrency:8,maxOperations:100000000};
const memoryUsage=()=>({
  heapUsed:30_000_000,rss:75_000_000,
  external:4_000_000,arrayBuffers:3_000_000
});
function clock(){
  let ticks=0;
  return ()=>{ticks+=5;return ticks;};
}
test('strict duration, event and operation ceiling admission',()=>{
  assert.deepEqual(cacheEnduranceOptions([
    '--durationMs=12000','--concurrency=8','--maxOperations=100000000'
  ],env),options);
  assert.equal(requestedCacheEnduranceDuration('schedule','0'),1_800_000);
  assert.equal(requestedCacheEnduranceDuration('workflow_dispatch','30'),1_800_000);
  assert.equal(requestedCacheEnduranceDuration('workflow_dispatch','60'),3_600_000);
  for(const invalid of [
    ['--durationMs=11999'],['--durationMs=3600001'],
    ['--concurrency=4'],['--maxOperations=200000000'],
    ['--x=3'],['--durationMs=12000','--durationMs=12000']
  ])assert.throws(()=>cacheEnduranceOptions(invalid,env));
  for(const bad of ['workflow_dispatch','unknown'])
    assert.throws(()=>cacheEnduranceOptions([],{
      GITHUB_EVENT_NAME:bad,NUBLOX_ENDURANCE_MINUTES:'0'
    }));
  assert.throws(()=>cacheEnduranceOptions([],{
    GITHUB_EVENT_NAME:'schedule',NUBLOX_ENDURANCE_MINUTES:'0'
  }));
  assert.throws(()=>cacheEnduranceOptions(
    ['--durationMs=1800000','--concurrency=8'],
    {GITHUB_EVENT_NAME:'workflow_dispatch',NUBLOX_ENDURANCE_MINUTES:'90'}
  ));
});
let valid;
test('eight native session workers sustain cached hot/churn work and release handles',async()=>{
  const env=fixture(),stages=[],windows=[];
  const workload=await runCacheEndurance({
    connect:env.connect,target,inspect:env.inspect,options,
    now:clock(),memoryUsage,gc:()=>{},
    onStage:x=>stages.push(x),onWindow:x=>windows.push(x)
  });
  assert.ok(workload.elapsedMs>=12000);
  assert.ok(workload.completed>200);
  assert.equal(workload.hot+workload.churn,workload.completed);
  assert.equal(workload.latency.count,workload.completed);
  assert.equal(workload.hotLatency.count,workload.hot);
  assert.equal(workload.churnLatency.count,workload.churn);
  assert.ok(workload.workers.every(w=>w.hot>0&&w.churn>0));
  assert.equal(env.connections,0);
  assert.equal(env.closed,8);
  assert.equal(env.maxHandles,8);
  assert.equal(workload.preparedAfterClose,0);
  assert.deepEqual(stages.slice(-2),['release-census','completed']);
  assert.deepEqual(windows,workload.windows);
  assert.equal(workload.memoryTimeline.samples.length,2);
  assert.equal(workload.progressTimeline.samples.length,2);
  assert.equal(workload.windows.length,1);
  valid={
    schemaVersion:1,kind:'mysql-verified-tls-cache-endurance',status:'passed',
    environment:{revision:sha,runId,event:'pull_request',ci:true,
      node:'v22.23.4',platform:'linux',arch:'x64',
      mysqlVersion:'8.4.13',transport:'verified-tls',
      maxPreparedStatements:8,tlsChecks:{
        verifiedTransport:true,nonemptyCipher:true,
        serverRequiresTls:true,unrelatedCaRejected:true
      }},
    options,workload,windows:workload.windows,
    progress:{phase:'completed'},errors:{codes:[]}
  };
  const decision=validateCacheEnduranceEvidence(valid,{
    revision:sha,runId,event:'pull_request',minutes:'0'
  });
  assert.equal(decision.completed,workload.completed);
  assert.equal(decision.preparedAfterClose,0);
});
test('independent evidence rejects tampering, incomplete duration or bad TLS',()=>{
  const judge=report=>validateCacheEnduranceEvidence(report,{
    revision:sha,runId,event:'pull_request',minutes:'0'
  });
  for(const alter of [
    r=>{r.workload.completed++;},
    r=>{r.workload.preparedAfterClose=1;},
    r=>{r.workload.windows[0].latency.count--;},
    r=>{r.workload.latency.p99Ms=-1;},
    r=>{r.workload.memoryEvidence.heapUsedGrowthBytes++;},
    r=>{r.workload.progressTimeline.samples.at(-1).completed--;},
    r=>{r.environment.tlsChecks.unrelatedCaRejected=false;},
    r=>{r.options.durationMs=1800000;},
    r=>{r.environment.revision='b'.repeat(40);},
    r=>{r.status='failed';},
    r=>{r.workload.elapsedMs=11999;}
  ]){
    const corrupted=structuredClone(valid);
    alter(corrupted);
    assert.throws(()=>judge(corrupted));
  }
  assert.deepEqual(selectCacheEnduranceReport([
    'mysql-cache-endurance-tls-'+runId+'.json'
  ],runId),'mysql-cache-endurance-tls-'+runId+'.json');
  assert.throws(()=>selectCacheEnduranceReport([
    'mysql-cache-endurance-tls-'+runId+'.json','unexpected.json'
  ],runId));
});
test('bad SQL outcomes fail closed and cannot publish passing workload',async()=>{
  for(const flags of [{badResult:true},{failQuery:true}]){
    const env=fixture(flags),stages=[];
    await assert.rejects(runCacheEndurance({
      connect:env.connect,target,inspect:env.inspect,options,
      now:clock(),memoryUsage,gc:()=>{},
      onStage:x=>stages.push(x)
    }),/Incorrect|fixture SQL error/);
    assert.equal(env.connections,0);
    assert.ok(['warming-sessions','measured-queries'].includes(stages.at(-1)));
    assert.equal(stages.includes('completed'),false);
  }
});
test('missing forced-GC support and already allocated handles fail early',async()=>{
  const env=fixture();
  await assert.rejects(runCacheEndurance({
    connect:env.connect,target,inspect:env.inspect,options,
    gc:null,now:clock(),memoryUsage
  }));
  await assert.rejects(runCacheEndurance({
    connect:env.connect,target,inspect:async()=>1,options,
    gc:()=>{},now:clock(),memoryUsage
  }),/Unexpected prepared handle census/);
  assert.equal(env.connections,0);
});
