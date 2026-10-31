import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseMixedOptions,mixedPhases,runMixedWorkloads} from './mixed-workloads.mjs';

function fixture({wrong=false,failPhase=null,rollbackWorks=true,leak=false}={}){
  let ms=0,closes=0,prepares=0,preparedCloses=0,cursorCloses=0,rollbacks=0;
  const value=n=>({rows:[{value:BigInt(wrong?n+1:n)}]});
  const lease={
    info:{version:'8.4.13'},get closed(){return closes>0;},
    async query(_sql,[n]){ms+=10;return value(n);},
    async prepare(){
      prepares++;return {
        async execute([n]){ms+=10;if(failPhase==='prepared')throw Error('fixture secret');return value(n);},
        async close(){preparedCloses++;}
      };
    },
    async withCursor(_sql,[first,second],fn){
      let closed=false;
      const cursor={
        get closed(){return closed;},
        async *[Symbol.asyncIterator](){
          try{
            ms+=10;
            if(failPhase==='cursor')throw Error('fixture secret');
            yield {row:{value:BigInt(first)}};
            yield {row:{value:BigInt(second)}};
          }finally{closed=true;cursorCloses++;}
        }
      };
      return fn(cursor);
    },
    async transaction(fn){
      if(failPhase==='transaction')throw Error('fixture secret');
      try{return await fn({query:async(_sql,[n])=>{ms+=10;return value(n);}});}
      catch(error){
        rollbacks++;
        if(!rollbackWorks)return null;
        throw error;
      }
    }
  };
  const pool={
    get stats(){return {size:closes?leak?1:0:1,idle:closes?0:1,
      active:closes?0:0,connecting:0,pending:0,
      created:1,discarded:closes?1:0};},
    async withConnection(fn){return fn(lease);},
    async close(){closes++;}
  };
  return {
    createPool:(_target,settings)=>{
      assert.equal(settings.maxConnections,2);
      return pool;
    },
    get counters(){return {closes,prepares,preparedCloses,cursorCloses,rollbacks};},
    now:()=>ms,
    memoryUsage:()=>({heapUsed:25_000_000,rss:90_000_000,
      external:3_000_000,arrayBuffers:1_000_000})
  };
}
const options=parseMixedOptions(['--durationMs=400','--concurrency=2','--maxOperations=1000']);

test('mixed options are bounded and fail closed on unknown/duplicate inputs',()=>{
  assert.equal(parseMixedOptions([]).durationMs,8000);
  assert.equal(parseMixedOptions([]).concurrency,4);
  assert.ok(Object.isFrozen(options));
  assert.deepEqual(mixedPhases,['query','prepared','cursor','transaction']);
  for(const arg of ['--durationMs=399','--durationMs=7200001','--concurrency=0',
    '--concurrency=17','--maxOperations=5','--maxOperations=100000001',
    '--unknown=2','--durationMs=x','--durationMs=-1'])
    assert.throws(()=>parseMixedOptions([arg]));
  assert.throws(()=>parseMixedOptions(['--concurrency=2','--concurrency=3']));
});

test('all four native paths, rollback, bounded latency, per-phase memory and pool cleanup',async()=>{
  const fixtureState=fixture();
  const result=await runMixedWorkloads({
    ...fixtureState,createPool:fixtureState.createPool,target:{engine:'mysql'},options
  });
  assert.equal(result.serverVersion,'8.4.13');
  assert.ok(result.observedDurationMs>=400);
  assert.equal(result.phases.length,4);
  assert.deepEqual(result.phases.map(x=>x.kind),mixedPhases);
  assert.ok(result.phases.every(x=>x.count>=2&&x.latencySamples<=1024));
  assert.equal(result.phases.reduce((a,x)=>a+x.count,0),result.completedOperations);
  assert.ok(result.expectedRollbacks>=1);
  assert.equal(result.resources.poolAfterClose.size,0);
  assert.equal(result.resources.memoryTrend.heapUsedGrowthBytes,0);
  assert.equal(result.resources.memoryTrend.rssGrowthBytes,0);
  assert.ok(result.resources.memoryTimeline.count>=6);
  const c=fixtureState.counters;
  assert.ok(c.rollbacks>=1);
  assert.equal(c.prepares,c.preparedCloses);
  assert.ok(c.cursorCloses>=2);
  assert.ok(c.closes>=1);
});

test('incorrect result and failing prepared statement close pool and fail qualification',async()=>{
  for(const variation of [{wrong:true},{failPhase:'prepared'}]){
    const f=fixture(variation);
    await assert.rejects(runMixedWorkloads({
      ...f,target:{},options
    }));
    assert.ok(f.counters.closes>=1);
    assert.equal(f.counters.prepares,f.counters.preparedCloses);
  }
});
test('swallowed transaction rollback and leaked native pool fail closed',async()=>{
  for(const variation of [{rollbackWorks:false},{leak:true}]){
    const f=fixture(variation);
    await assert.rejects(runMixedWorkloads({...f,target:{},options}));
    assert.ok(f.counters.closes>=1);
  }
});
test('a too-small operation ceiling cannot claim a completed timed phase',async()=>{
  const f=fixture();
  const cap=parseMixedOptions(['--durationMs=400','--concurrency=2','--maxOperations=100']);
  // Slow the fixture clock less per completed query: operations hit the cap
  // before the elapsed-time acceptance criteria.
  let fakeClock=0;
  await assert.rejects(runMixedWorkloads({
    ...f,target:{},options:cap,
    now:()=>fakeClock++/10000
  }),/operation cap/);
  assert.ok(f.counters.closes>=1);
});
