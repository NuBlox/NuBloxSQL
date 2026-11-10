import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CACHE_MODES,CACHE_HOT_SQL,CACHE_CHURN_SQL,cacheProfileOptions,
  runCacheTrial,runCacheMatrix} from './cache-concurrency.mjs';

function fixture({brokenEviction=false,wrongResult=false,leak=false}={}){
  const sessions=new Set();
  let nativeHandles=0,peak=0,commands=0,closed=0;
  const open=async mode=>{
    const handles=new Map();
    let ended=false;
    const session={
      async query(sql,params){
        assert.equal(ended,false);
        assert.ok([CACHE_HOT_SQL,CACHE_CHURN_SQL].includes(sql));
        assert.equal(params.length,1);
        commands++;
        if(mode==='uncached'){
          nativeHandles++;
          peak=Math.max(peak,nativeHandles);
          if(nativeHandles>4)throw Error('Server quota exceeded');
          nativeHandles--;
        }else if(!handles.has(sql)){
          if(handles.size===1&&!brokenEviction){
            handles.delete(handles.keys().next().value);
            nativeHandles--;
          }
          nativeHandles++;
          peak=Math.max(peak,nativeHandles);
          if(nativeHandles>4){
            nativeHandles--; // failed prepare did not allocate a server handle
            throw Error('Server quota exceeded');
          }
          if(handles.size===1){
            handles.delete(handles.keys().next().value);
            nativeHandles--;
          }
          handles.set(sql,true);
        }
        await Promise.resolve();
        return {rows:[{value:BigInt(params[0]+(wrongResult?1:0))}]};
      },
      async close(){
        if(ended)return;
        ended=true;closed++;
        if(!leak)nativeHandles-=handles.size;
        sessions.delete(session);
      }
    };
    sessions.add(session);
    return session;
  };
  return {
    open,inspect:async()=>nativeHandles,
    get peak(){return peak;},
    get openSessions(){return sessions.size;},
    get commands(){return commands;},
    get closed(){return closed;}
  };
}

test('bounded options reject invalid, duplicated and excessive live work',()=>{
  assert.deepEqual(cacheProfileOptions([]),{
    iterations:64,concurrency:4,rounds:2
  });
  for(const args of [
    ['--iterations=15'],['--iterations=2001'],['--concurrency=0'],
    ['--concurrency=9'],['--rounds=1'],['--rounds=9'],
    ['--iterations=NaN'],['--iterations=-5'],['--unknown=4'],
    ['--iterations=16','--iterations=17'],
    ['--iterations=16','--concurrency=8']
  ])assert.throws(()=>cacheProfileOptions(args));
  assert.ok(Object.isFrozen(cacheProfileOptions([])));
});

test('multiple sessions and rotating SQL retain bounded native handles',async()=>{
  const env=fixture();
  let tick=0;
  const trials=await runCacheMatrix({
    open:env.open,inspect:env.inspect,
    iterations:64,concurrency:4,rounds:2,now:()=>++tick
  });
  assert.deepEqual(trials.map(t=>t.mode),
    ['uncached','cached','churn','cached','uncached','churn']);
  assert.equal(trials.length,6);
  for(const trial of trials){
    assert.equal(trial.latency.count,64);
    assert.ok(trial.latency.p95Ms>=0);
    assert.equal(trial.preparedAfterWarmup,
      trial.mode==='uncached'?0:4);
    assert.equal(trial.preparedAfterWork,
      trial.mode==='uncached'?0:4);
    assert.equal(trial.preparedAfterClose,0);
  }
  assert.equal(env.peak,4);
  assert.equal(env.openSessions,0);
  assert.equal(env.closed,24);
  assert.equal(env.commands,6*(64+4*4));
});

test('quota stress detects transient prepare before eviction and cleans sockets',async()=>{
  const env=fixture({brokenEviction:true});
  await assert.rejects(runCacheTrial({
    open:env.open,inspect:env.inspect,mode:'churn',
    iterations:24,concurrency:4
  }),/Server quota exceeded/);
  assert.equal(env.openSessions,0);
});

test('incorrect SQL results and retained server handles fail qualification',async()=>{
  const bad=fixture({wrongResult:true});
  await assert.rejects(runCacheTrial({
    open:bad.open,inspect:bad.inspect,mode:'cached',
    iterations:16,concurrency:2
  }),/Incorrect warmup SELECT value/);
  assert.equal(bad.openSessions,0);
  const leak=fixture({leak:true});
  await assert.rejects(runCacheTrial({
    open:leak.open,inspect:leak.inspect,mode:'cached',
    iterations:16,concurrency:2
  }),/Prepared statements remain/);
  assert.equal(leak.openSessions,0);
});

test('invalid trial setup is rejected before opening connections',async()=>{
  const env=fixture();
  for(const mode of ['unknown',null]){
    await assert.rejects(runCacheTrial({
      open:env.open,inspect:env.inspect,mode,iterations:16,concurrency:2
    }));
  }
  assert.equal(env.openSessions,0);
});

test('progress evidence preserves completed trials and failed round/mode without SQL',async()=>{
  const fixtureEnv=fixture();
  const stages=[],completed=[];
  await assert.rejects(runCacheMatrix({
    open:async mode=>{
      if(mode==='churn')throw Error('injected native open failure');
      return fixtureEnv.open(mode);
    },
    inspect:fixtureEnv.inspect,iterations:32,concurrency:4,rounds:2,
    onStage:stage=>stages.push(stage),
    onTrial:trial=>completed.push(trial)
  }),/injected native open failure/);
  assert.deepEqual(completed.map(x=>[x.round,x.mode]),
    [[1,'uncached'],[1,'cached']]);
  assert.deepEqual(stages.at(-1),
    {round:1,mode:'churn',phase:'opening-sessions'});
  assert.equal(fixtureEnv.openSessions,0);
  assert.ok(stages.every(stage=>Object.isFrozen(stage)));
  assert.equal(JSON.stringify(stages).includes(CACHE_HOT_SQL),false);
});

test('failed warmup preserves its phase while session cleanup still runs',async()=>{
  const fixtureEnv=fixture({wrongResult:true});
  const stages=[];
  await assert.rejects(runCacheMatrix({
    open:fixtureEnv.open,inspect:fixtureEnv.inspect,
    iterations:32,concurrency:4,rounds:2,
    onStage:stage=>stages.push(stage)
  }),/Incorrect warmup SELECT value/);
  assert.deepEqual(stages.at(-1),
    {round:1,mode:'uncached',phase:'warming-sessions'});
  assert.equal(fixtureEnv.openSessions,0);
});

test('qualification progress callbacks must be callable',async()=>{
  const fixtureEnv=fixture();
  for(const options of [{onStage:null},{onTrial:12}]){
    await assert.rejects(runCacheMatrix({
      open:fixtureEnv.open,inspect:fixtureEnv.inspect,
      iterations:32,concurrency:4,rounds:2,...options
    }),/Invalid cache qualification progress callback/);
  }
  assert.equal(fixtureEnv.openSessions,0);
});

test('uncached census tolerates delayed unacknowledged server CLOSE packets',async()=>{
  const env=fixture();
  let reads=0;
  const inspect=async()=>{
    reads++;
    // Before: zero. After warmup and after measured queries: two
    // transient nonzero counts before a second connection sees the CLOSEs.
    if([2,3,5,6].includes(reads))return 1;
    return env.inspect();
  };
  const trial=await runCacheTrial({
    open:env.open,inspect,mode:'uncached',
    iterations:32,concurrency:4
  });
  assert.equal(trial.preparedAfterWarmup,0);
  assert.equal(trial.preparedAfterWork,0);
  assert.equal(trial.preparedAfterClose,0);
  assert.ok(reads>=8);
  assert.equal(env.openSessions,0);
});

test('uncached census still fails when server CLOSE remains unobserved',async()=>{
  const env=fixture();
  let reads=0;
  const inspect=async()=>{
    reads++;
    // Preflight reads zero; the next 25 reads never settle. The final
    // cleanup census succeeds, so the original bounded-check error remains.
    if(reads>=2&&reads<=26)return 1;
    return 0;
  };
  const stages=[];
  await assert.rejects(runCacheTrial({
    open:env.open,inspect,mode:'uncached',
    iterations:32,concurrency:4,
    onPhase:stage=>stages.push(stage)
  }),/Unexpected native server prepared-statement count during after warmup/);
  assert.equal(stages.at(-1),'warmup-census');
  assert.equal(env.openSessions,0);
  assert.equal(reads,27);
});
