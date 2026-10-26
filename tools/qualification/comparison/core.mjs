import {performance} from 'node:perf_hooks';
import {summarize} from '../metrics.mjs';

export const COMPARISON_SQL='SELECT ? AS value';
export const COMPARISON_CLIENTS=Object.freeze(['nubloxsql','mysql2']);
export const COMPARISON_WORKLOADS=Object.freeze([
  'connectionOnly','preparedSequential','preparedConcurrent'
]);

function assertOptions(options){
  const {iterations,concurrency,rounds}=options??{};
  if(!Number.isSafeInteger(iterations)||iterations<4||iterations>2000||
    !Number.isSafeInteger(concurrency)||concurrency<1||concurrency>8||
    !Number.isSafeInteger(rounds)||rounds<2||rounds>8)
    throw Error('Invalid bounded comparison parameters');
}

function assertValue(value,expected){
  if(typeof value!=='bigint'&&typeof value!=='number'&&typeof value!=='string')
    throw Error('Unexpected prepared result type');
  if(Number(value)!==expected)
    throw Error('Comparison query returned incorrect data');
}

async function connectionOnly(adapter,iterations,concurrency,now){
  // A warm connection and its closure are excluded from timing.
  const warmup=await adapter.open();
  await warmup.close();
  const samples=[];
  let next=0;
  const started=now();
  await Promise.all(Array.from({length:concurrency},()=> (async()=>{
    while(next<iterations){
      next++;
      const start=now();
      const session=await adapter.open();
      samples.push(now()-start);
      // Close is outside each handshake latency sample but inside the
      // elapsed wall clock, keeping physical open sockets bounded.
      await session.close();
    }
  })()));
  return summarize(samples,now()-started);
}

async function prepared(adapter,iterations,concurrency,now){
  const sessions=[];
  try{
    // Prepare and warm up identically for each vendor before timing.
    for(let worker=0;worker<concurrency;worker++){
      const session=await adapter.open();
      const owned={session,statement:null};
      sessions.push(owned);
      owned.statement=await session.prepare(COMPARISON_SQL);
      for(let i=0;i<8;i++)
        assertValue(await owned.statement.execute([i]),i);
    }
    let next=0;
    const samples=[];
    const started=now();
    await Promise.all(sessions.map(({statement})=>(async()=>{
      while(next<iterations){
        const id=next++;
        const start=now();
        const result=await statement.execute([id]);
        assertValue(result,id);
        samples.push(now()-start);
      }
    })()));
    return summarize(samples,now()-started);
  }finally{
    const outcomes=await Promise.allSettled(sessions.map(async({session,statement})=>{
      try{await statement?.close();}finally{await session.close();}
    }));
    if(outcomes.some(x=>x.status==='rejected'))
      throw Error('Comparison prepared cleanup failed');
  }
}

/** Compare only semantically matched workloads, without retries or pool
 * policy differences. Reverse vendor execution order in alternating rounds
 * to expose warm cache and order effects; retain per-round evidence. */
export async function runComparison({adapters,iterations=48,concurrency=4,rounds=4,now=()=>performance.now()}){
  assertOptions({iterations,concurrency,rounds});
  if(typeof now!=='function'||COMPARISON_CLIENTS.some(name=>
    typeof adapters?.[name]?.open!=='function'))
    throw Error('Both native and competitor adapters are required');

  const results=[];
  for(let round=1;round<=rounds;round++){
    const order=round%2?COMPARISON_CLIENTS:[...COMPARISON_CLIENTS].reverse();
    for(const workload of COMPARISON_WORKLOADS){
      for(const client of order){
        const adapter=adapters[client];
        const stats=workload==='connectionOnly'
          ?await connectionOnly(adapter,iterations,concurrency,now)
          :await prepared(adapter,iterations,
            workload==='preparedSequential'?1:concurrency,now);
        if(stats.count!==iterations)
          throw Error('Comparison workload was not completed');
        results.push(Object.freeze({round,workload,client,...stats}));
      }
    }
  }
  return Object.freeze(results);
}
