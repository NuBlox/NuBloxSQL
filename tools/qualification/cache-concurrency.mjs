import {performance} from 'node:perf_hooks';
import {summarize,integerOption} from './metrics.mjs';

/** Explicitly tagged SQL for this isolated qualification fixture only.
 * Do not copy SQL strings into the persisted evidence report. */
export const CACHE_HOT_SQL='SELECT ? AS value /* nublox_cache_hot_probe */';
export const CACHE_CHURN_SQL='SELECT ? AS value /* nublox_cache_churn_probe */';
export const CACHE_MODES=Object.freeze(['uncached','cached','churn']);

export function cacheProfileOptions(argv=[]){
  const raw={};
  for(const arg of argv){
    const m=/^--(iterations|concurrency|rounds)=([0-9]+)$/.exec(arg);
    if(!m||Object.hasOwn(raw,m[1]))
      throw Error('Unknown, repeated or malformed cache qualification option');
    raw[m[1]]=m[2];
  }
  const iterations=integerOption(raw.iterations??64,{name:'iterations',min:16,max:2000});
  const concurrency=integerOption(raw.concurrency??4,{name:'concurrency',min:1,max:8});
  const rounds=integerOption(raw.rounds??2,{name:'rounds',min:2,max:8});
  if(iterations<concurrency*4)
    throw Error('At least four measured queries per connection are required');
  return Object.freeze({iterations,concurrency,rounds});
}

function checkHandleCount(actual,expected,phase){
  if(!Number.isSafeInteger(actual)||actual!==expected)
    throw Error('Unexpected native server prepared-statement count during '+phase);
}

/** Poll bounded server-side ownership after destroying the native sockets.
 * The TCP-close callback and server Performance Schema cleanup may race. */
async function awaitReleased(inspect){
  for(let i=0;i<25;i++){
    const count=await inspect();
    if(count===0)return 0;
    if(!Number.isSafeInteger(count)||count<0)
      throw Error('Invalid server prepared-statement census');
    if(i<24)await new Promise(resolve=>setTimeout(resolve,40));
  }
  throw Error('Prepared statements remain after native connection closure');
}

/** One trial holds exactly one physical MySQL session per concurrent worker.
 * No pooling, cross-lease caching, retries, or unbounded scheduling.
 * Samples are end-to-end SQL command time, including real round trips. */
export async function runCacheTrial({
  open,inspect,mode,iterations,concurrency,now=()=>performance.now()
}){
  if(!CACHE_MODES.includes(mode)||typeof open!=='function'||
    typeof inspect!=='function'||typeof now!=='function')
    throw Error('Invalid cache trial inputs');
  if(!Number.isSafeInteger(iterations)||iterations<1||
    !Number.isSafeInteger(concurrency)||concurrency<1||concurrency>8||
    iterations<concurrency)
    throw Error('Invalid bounded cache trial work');
  checkHandleCount(await inspect(),0,'before trial');
  const sessions=[];
  let result;
  try{
    for(let worker=0;worker<concurrency;worker++)
      sessions.push(await open(mode));
    // Identical warmup quantity, query and bound types for both comparable
    // hot workloads; churn deliberately starts with the same hot statement.
    for(let worker=0;worker<sessions.length;worker++)
      for(let warm=0;warm<4;warm++){
        const value=await sessions[worker].query(CACHE_HOT_SQL,[-1-warm]);
        if(value.rows[0]?.value!==BigInt(-1-warm))
          throw Error('Incorrect warmup SELECT value');
      }
    const expectedHandles=mode==='uncached'?0:concurrency;
    const preparedAfterWarmup=await inspect();
    checkHandleCount(preparedAfterWarmup,expectedHandles,'after warmup');
    let next=0;
    const samples=[];
    const started=now();
    await Promise.all(sessions.map(session=>(async()=>{
      let local=0;
      while(next<iterations){
        const id=next++;
        // Toggle SQL on *each* session, not on global ID parity. With four
        // workers, global parity could accidentally never churn a cache.
        const sql=mode==='churn'&&(local++%2)===1
          ?CACHE_CHURN_SQL:CACHE_HOT_SQL;
        const start=now();
        const result=await session.query(sql,[id]);
        const duration=now()-start;
        if(result.rows[0]?.value!==BigInt(id))
          throw Error('Incorrect measured SELECT value');
        samples.push(duration);
      }
    })()));
    const elapsed=now()-started;
    const preparedAfterWork=await inspect();
    checkHandleCount(preparedAfterWork,expectedHandles,'after workload');
    const latency=summarize(samples,elapsed);
    if(latency.count!==iterations)
      throw Error('Incomplete prepared-statement workload');
    result={
      mode,preparedAfterWarmup,preparedAfterWork,
      maxExpectedServerHandles:concurrency,
      latency
    };
  }finally{
    // Never leave open sessions after a failed assertion or SQL error.
    const closed=await Promise.allSettled(sessions.map(s=>s.close()));
    if(closed.some(x=>x.status==='rejected'))
      throw Error('Native cache trial session cleanup failed');
    await awaitReleased(inspect);
  }
  return Object.freeze({...result,preparedAfterClose:0});
}

export async function runCacheMatrix({
  open,inspect,iterations=64,concurrency=4,rounds=2,
  now=()=>performance.now()
}){
  const opts=cacheProfileOptions([
    '--iterations='+iterations,'--concurrency='+concurrency,'--rounds='+rounds
  ]);
  const results=[];
  for(let round=1;round<=opts.rounds;round++){
    // Reverse hot-workload order to reduce server warmup/order bias;
    // churn is reported separately as a quota correctness stress.
    const order=round%2===1
      ?CACHE_MODES:['cached','uncached','churn'];
    for(const mode of order){
      const trial=await runCacheTrial({
        open,inspect,mode,iterations:opts.iterations,
        concurrency:opts.concurrency,now
      });
      results.push(Object.freeze({round,...trial}));
    }
  }
  return Object.freeze(results);
}
