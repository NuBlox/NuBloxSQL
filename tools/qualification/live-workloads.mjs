/**
 * Real-database workload instrumentation. No instrumentation runs inside the
 * published Driver. Results report observed process memory, not allocation
 * attribution or a claim of production throughput.
 */
import {performance} from 'node:perf_hooks';
import {summarize,integerOption} from './metrics.mjs';

const optionsBounds={
  samples:[3,1000,30],
  rows:[100,1000,500],
  rowBytes:[256,8192,4096],
  concurrency:[1,16,4],
  durationMs:[500,120000,3000],
  maxOperations:[100,1000000,100000]
};

export function parseLiveOptions(argv){
  const parsed={};
  for(const arg of argv){
    const match=/^--([A-Za-z]+)=([0-9]+)$/.exec(arg);
    if(!match||!Object.hasOwn(optionsBounds,match[1])||
       Object.hasOwn(parsed,match[1]))
      throw new Error('Invalid or duplicate live workload option');
    parsed[match[1]]=match[2];
  }
  const options={};
  for(const [key,[min,max,fallback]] of Object.entries(optionsBounds))
    options[key]=integerOption(parsed[key]??fallback,{name:key,min,max});
  if(options.rows*options.rowBytes>8*1024*1024)
    throw new RangeError('Large result workload exceeds 8 MiB payload budget');
  return Object.freeze(options);
}

const memoryKeys=['heapUsed','rss','external','arrayBuffers'];
function recordMemory(peak,current){
  for(const key of memoryKeys)peak[key]=Math.max(peak[key],current[key]);
}

/** Keep the sampler outside native code. Capture both periodic and boundary
 * observations; a peak between polls is not guaranteed to be observed. */
async function measure(work){
  const startMemory=process.memoryUsage(),peak={...startMemory};
  const poll=setInterval(()=>recordMemory(peak,process.memoryUsage()),10);
  poll.unref();
  const cpuStart=process.cpuUsage(),start=performance.now();
  try{
    const result=await work();
    return {result,resources:resourceSnapshot()};
  }finally{
    clearInterval(poll);
  }
  function resourceSnapshot(){
    recordMemory(peak,process.memoryUsage());
    const cpu=process.cpuUsage(cpuStart);
    const delta={},max={};
    for(const key of memoryKeys){
      delta[key+'DeltaBytes']=Math.max(0,peak[key]-startMemory[key]);
      max[key+'PeakBytes']=peak[key];
    }
    return {...delta,...max,wallTimeMs:Math.round((performance.now()-start)*1000)/1000,
      userCpuMs:Math.round(cpu.user/1000),systemCpuMs:Math.round(cpu.system/1000)};
  }
}
const check=(ok)=>{if(!ok)throw new Error('Live workload result assertion failed');};

const largeSql=`SELECT a.n+10*b.n+100*c.n AS ordinal, REPEAT('x', ?) AS payload
FROM (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL
      SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL
      SELECT 8 UNION ALL SELECT 9) a
JOIN (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL
      SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL
      SELECT 8 UNION ALL SELECT 9) b
JOIN (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL
      SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL
      SELECT 8 UNION ALL SELECT 9) c
WHERE a.n+10*b.n+100*c.n < ? ORDER BY ordinal`;

export async function profileLiveWorkloads({connect,createPool,target,options}){
  const workloads={},resources={};
  let serverVersion=null;
  {
    const measured=await measure(async()=>{
      const db=await connect(target);
      try{
        serverVersion=db.info.version;
        const stmt=await db.prepare('SELECT ? AS sample_value');
        try{
          for(let i=0;i<8;i++)
            check(Number((await stmt.execute([i])).rows[0].sample_value)===i);
          const samples=[],start=performance.now();
          for(let i=0;i<options.samples;i++){
            const time=performance.now();
            const result=await stmt.execute([i]);
            check(Number(result.rows[0].sample_value)===i);
            samples.push(performance.now()-time);
          }
          return summarize(samples,performance.now()-start);
        }finally{await stmt.close();}
      }finally{await db.close();}
    });
    workloads.prepared=measured.result;
    resources.prepared=measured.resources;
  }
  {
    const measured=await measure(async()=>{
      const db=await connect(target);
      try{
        const samples=[],count=Math.max(3,Math.ceil(options.samples/3));
        const run=async()=>{
          const result=await db.query(largeSql,[options.rowBytes,options.rows]);
          check(result.rows.length===options.rows);
          check(result.rowValues?.length===options.rows);
          for(let i=0;i<result.rows.length;i++){
            const row=result.rows[i];
            check(Number(row.ordinal)===i&&
              typeof row.payload==='string'&&row.payload.length===options.rowBytes);
          }
        };
        await run(); // warmup is excluded
        const start=performance.now();
        for(let i=0;i<count;i++){
          const time=performance.now();
          await run();
          samples.push(performance.now()-time);
        }
        return {...summarize(samples,performance.now()-start),
          rowsPerQuery:options.rows,payloadBytesPerRow:options.rowBytes,
          validatedPayloadBytes:count*options.rows*options.rowBytes};
      }finally{await db.close();}
    });
    workloads.largeResults=measured.result;
    resources.largeResults=measured.resources;
  }
  {
    const measured=await measure(async()=>{
      const pool=createPool(target,{maxConnections:options.concurrency,
        acquireTimeoutMs:12000,idleTimeoutMs:60000,healthCheckTimeoutMs:2000});
      try{
        await pool.withConnection(async db=>{
          check(Number((await db.query('SELECT ? AS sample_value',[0]))
            .rows[0].sample_value)===0);
        });
        let issued=0,failed=null;
        const samples=[],start=performance.now();
        const workers=Array.from({length:options.concurrency},()=> (async()=>{
          while(!failed&&performance.now()-start<options.durationMs){
            const i=issued++;
            if(i>=options.maxOperations)break;
            const time=performance.now();
            try{
              await pool.withConnection(async db=>{
                const value=await db.query('SELECT ? AS sample_value',[i]);
                check(Number(value.rows[0].sample_value)===i);
              });
              samples.push(performance.now()-time);
            }catch(error){failed=error;}
          }
        })());
        await Promise.all(workers);
        if(failed)throw failed;
        const elapsed=performance.now()-start;
        check(samples.length>=options.concurrency);
        // Hitting the operation ceiling is NOT a valid sustained-duration run.
        check(elapsed>=options.durationMs&&issued<options.maxOperations);
        check(pool.stats.pending===0&&pool.stats.size<=options.concurrency);
        return {...summarize(samples,elapsed),workerCount:options.concurrency,
          completed:samples.length,requestedDurationMs:options.durationMs};
      }finally{
        await pool.close();
        check(pool.stats.size===0);
      }
    });
    workloads.concurrent=measured.result;
    resources.concurrent=measured.resources;
  }
  return {serverVersion,workloads,resources};
}
