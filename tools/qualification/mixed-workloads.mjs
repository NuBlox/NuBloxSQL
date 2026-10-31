/**
 * Four native workloads exercised in bounded concurrent, timed phases.
 * All SQL is read-only. Explicit transaction rollbacks are deliberate and
 * checked; there is never automatic replay of user/application SQL.
 */
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {integerOption} from './metrics.mjs';
import {BoundedLatencySamples,BoundedMemoryTimeline,validateMemoryTimeline}
  from './soak-observations.mjs';

export const mixedPhases=Object.freeze(['query','prepared','cursor','transaction']);
const fail=message=>{throw new Error(message);};
const requireValue=(result,value)=>{
  if(result?.rows?.length!==1||BigInt(result.rows[0].value)!==BigInt(value))
    fail('Mixed workload returned incorrect result');
};
const memorySnapshot=usage=>Object.freeze({
  heapUsedBytes:usage.heapUsed,rssBytes:usage.rss,
  externalBytes:usage.external,arrayBuffersBytes:usage.arrayBuffers
});
export function parseMixedOptions(args){
  const names=new Set(['durationMs','concurrency','maxOperations']);
  const values={};
  for(const arg of args){
    const match=/^--([A-Za-z]+)=([0-9]+)$/.exec(arg);
    if(!match||!names.has(match[1])||Object.hasOwn(values,match[1]))
      fail('Unknown or repeated mixed qualification option');
    values[match[1]]=match[2];
  }
  return Object.freeze({
    durationMs:integerOption(values.durationMs??8000,
      {name:'durationMs',min:400,max:7_200_000}),
    concurrency:integerOption(values.concurrency??4,
      {name:'concurrency',min:1,max:16}),
    maxOperations:integerOption(values.maxOperations??1_000_000,
      {name:'maxOperations',min:100,max:100_000_000})
  });
}
async function oneOperation(lease,kind,index,rollback){
  if(kind==='query'){
    requireValue(await lease.query('SELECT ? AS value',[index]),index);
  }else if(kind==='prepared'){
    const stmt=await lease.prepare('SELECT ? AS value');
    try{requireValue(await stmt.execute([index]),index);}
    finally{await stmt.close();}
  }else if(kind==='cursor'){
    await lease.withCursor(
      'SELECT ? AS value UNION ALL SELECT ?',[index,index+1],
      async cursor=>{
        let count=0;
        for await(const {row} of cursor){
          if(BigInt(row.value)!==BigInt(index+count))fail('Cursor order mismatch');
          count++;
        }
        if(count!==2||!cursor.closed)fail('Cursor not fully consumed');
      },{fetchSize:1}
    );
  }else if(kind==='transaction'){
    const deliberate=new Error('Expected qualification rollback');
    try{
      await lease.transaction(async tx=>{
        requireValue(await tx.query('SELECT ? AS value',[index]),index);
        if(rollback)throw deliberate;
      });
      if(rollback)fail('Expected transaction rollback was not executed');
    }catch(error){
      if(!rollback||error!==deliberate)throw error;
      requireValue(await lease.query('SELECT ? AS value',[index]),index);
    }
  }else fail('Unsupported mixed workload phase');
}
/**
 * Capture every operation count but only bounded latency and memory samples.
 * Phase boundaries provide evidence of each API workload's process context.
 */
export async function runMixedWorkloads({
  createPool,target,options,now=()=>performance.now(),
  memoryUsage=()=>process.memoryUsage()
}){
  assert.ok(typeof createPool==='function'&&typeof now==='function');
  const pool=createPool(target,{
    maxConnections:options.concurrency,acquireTimeoutMs:12000,
    idleTimeoutMs:60000,healthCheckTimeoutMs:2000
  });
  let sampler=null;
  const phases=[];
  let issued=0,completed=0,rollbacks=0,serverVersion=null;
  let beforeClose;
  try{
    await pool.withConnection(async lease=>{
      serverVersion=lease.info.version;
      requireValue(await lease.query('SELECT ? AS value',[0]),0);
    });
    const start=now();
    sampler=new BoundedMemoryTimeline();
    sampler.record(0,memoryUsage());
    const timer=setInterval(()=>{
      sampler.record(now()-start,memoryUsage());
    },30000);
    timer.unref();
    try{
      for(let phaseIndex=0;phaseIndex<mixedPhases.length;phaseIndex++){
        const kind=mixedPhases[phaseIndex];
        const deadline=start+(options.durationMs*(phaseIndex+1))/mixedPhases.length;
        const stats=new BoundedLatencySamples(1024);
        let phaseIssued=0,phaseRollbacks=0,failed=null;
        const phaseStarted=now(),phaseMemoryBefore=memorySnapshot(memoryUsage());
        const workers=Array.from({length:options.concurrency},()=> (async()=>{
          while(!failed&&now()<deadline){
            if(issued>=options.maxOperations){
              failed=new Error('Mixed qualification hit operation cap early');
              break;
            }
            const index=issued++;
            const rollback=kind==='transaction'&&phaseIssued%17===0;
            phaseIssued++;
            const launched=now();
            try{
              await pool.withConnection(lease=>oneOperation(lease,kind,index,rollback));
              if(rollback){phaseRollbacks++;rollbacks++;}
              stats.record(now()-launched);
              completed++;
            }catch(error){failed=error;}
          }
        })());
        await Promise.all(workers);
        if(failed)throw failed;
        const elapsed=now()-phaseStarted;
        if(stats.count<options.concurrency||now()<deadline)
          fail('Mixed qualification exited before phase completed');
        const memoryAfter=memorySnapshot(memoryUsage());
        phases.push(Object.freeze({
          kind,...stats.summarize(elapsed),expectedRollbacks:phaseRollbacks,
          memoryBefore:phaseMemoryBefore,memoryAfter
        }));
        sampler.record(now()-start,memoryUsage());
      }
    }finally{clearInterval(timer);}
    const durationObservedMs=now()-start;
    if(durationObservedMs<options.durationMs)
      fail('Mixed qualification missed requested elapsed duration');
    beforeClose=pool.stats;
    if(beforeClose.size>options.concurrency||beforeClose.pending!==0)
      fail('Mixed qualification retained pending pool checkouts');
    const memoryTimeline=sampler.summary();
    const memoryTrend=validateMemoryTimeline(memoryTimeline,
      {minDurationMs:options.durationMs});
    await pool.close();
    const afterClose=pool.stats;
    if(afterClose.size!==0||afterClose.pending!==0||
      afterClose.active!==0||afterClose.connecting!==0)
      fail('Mixed qualification left physical pool resources');
    return Object.freeze({
      serverVersion,requestedDurationMs:options.durationMs,
      observedDurationMs:durationObservedMs,completedOperations:completed,
      expectedRollbacks:rollbacks,phases,
      resources:{poolBeforeClose:beforeClose,poolAfterClose:afterClose,
        memoryTimeline,memoryTrend}
    });
  }finally{
    await pool.close();
  }
}
