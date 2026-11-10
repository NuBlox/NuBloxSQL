/** Sustained cache reuse and eviction over eight independent verified-TLS
 * native MySQL sessions. Qualification-only; no SQL replay or writes. */
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {integerOption} from './metrics.mjs';
import {CACHE_HOT_SQL,CACHE_CHURN_SQL} from './cache-concurrency.mjs';
import {BoundedLatencySamples,BoundedMemoryTimeline,BoundedProgressTimeline,
  validateMemoryTimeline,validateProgressTimeline} from './soak-observations.mjs';

export function requestedCacheEnduranceDuration(event,minutes){
  if(event==='pull_request'||event==='push')return 12000;
  if(event==='schedule')return 1800000;
  if(event==='workflow_dispatch'&&(minutes==='30'||minutes==='60'))
    return Number(minutes)*60000;
  throw Error('Unsupported cache endurance event or duration');
}
export function cacheEnduranceOptions(argv,env){
  const given={};
  for(const arg of argv){
    const m=/^--(durationMs|concurrency|maxOperations)=([0-9]+)$/.exec(arg);
    if(!m||Object.hasOwn(given,m[1]))
      throw Error('Unknown, duplicate or malformed cache endurance option');
    given[m[1]]=m[2];
  }
  const durationMs=integerOption(given.durationMs??12000,
    {name:'durationMs',min:12000,max:3600000});
  const concurrency=integerOption(given.concurrency??8,
    {name:'concurrency',min:8,max:8});
  const maxOperations=integerOption(given.maxOperations??100000000,
    {name:'maxOperations',min:100000000,max:100000000});
  if(durationMs!==requestedCacheEnduranceDuration(
    env?.GITHUB_EVENT_NAME,env?.NUBLOX_ENDURANCE_MINUTES))
    throw Error('Cache endurance duration does not match trusted CI event');
  return Object.freeze({durationMs,concurrency,maxOperations});
}
async function waitForZero(inspect){
  for(let i=0;i<25;i++){
    const count=await inspect();
    if(!Number.isSafeInteger(count)||count<0)
      throw Error('Invalid prepared-statement census');
    if(count===0)return 0;
    if(i<24)await new Promise(resolve=>setTimeout(resolve,40));
  }
  throw Error('Native prepared handles remain after endurance session close');
}

/** Interval latency is a bounded reservoir approximation, not raw p99.
 * Every successful SQL operation is counted; no operation result is retained.
 * A separate observer connection must never allocate prepared statements. */
export async function runCacheEndurance({
  connect,target,inspect,options,now=()=>performance.now(),
  memoryUsage=()=>process.memoryUsage(),gc=global.gc,
  onStage=()=>{},onWindow=()=>{}
}){
  assert.equal(typeof connect,'function');
  assert.equal(typeof inspect,'function');
  assert.equal(typeof now,'function');
  assert.equal(typeof memoryUsage,'function');
  assert.equal(typeof gc,'function','--expose-gc is required');
  assert.equal(typeof onStage,'function');
  assert.equal(typeof onWindow,'function');
  assert.ok(target&&target.security==='verified-tls');
  assert.ok(options&&Number.isSafeInteger(options.durationMs)&&
    options.durationMs>0&&options.durationMs<=3600000&&
    options.concurrency===8&&
    options.maxOperations===100000000);
  const sessions=[];
  const workers=Array.from({length:8},()=>({hot:0,churn:0}));
  const allLatency=new BoundedLatencySamples(4096);
  const hotLatency=new BoundedLatencySamples(4096);
  const churnLatency=new BoundedLatencySamples(4096);
  const memory=new BoundedMemoryTimeline({intervalMs:30000,capacity:256});
  const progress=new BoundedProgressTimeline({intervalMs:30000,capacity:256});
  const windows=[];
  let completed=0,issued=0,hot=0,churn=0,started=0,lastWindowAt=0;
  let windowLatency=new BoundedLatencySamples(1024);
  let timer,phase='preflight',samplingError=null,completedRun=false;
  const stage=next=>{phase=next;onStage(next);};
  const inspectCount=async(expected,description)=>{
    const count=await inspect();
    if(!Number.isSafeInteger(count)||count!==expected)
      throw Error('Unexpected prepared handle census: '+description);
  };
  try{
    stage('preflight');
    await inspectCount(0,'before warmup');
    stage('opening-sessions');
    for(let w=0;w<options.concurrency;w++)
      sessions.push(await connect({...target,statementCacheSize:1}));
    stage('warming-sessions');
    for(let w=0;w<sessions.length;w++){
      for(let i=0;i<4;i++){
        const result=await sessions[w].query(CACHE_HOT_SQL,[-i-1]);
        if(result.rows[0]?.value!==BigInt(-i-1))
          throw Error('Incorrect native prepared warmup result');
      }
    }
    await inspectCount(8,'warmed sessions');
    gc();
    const postWarmupGc=memoryUsage();
    started=now();
    lastWindowAt=started;
    memory.record(0,postWarmupGc);
    progress.record(0,0);
    const capture=()=>{
      const elapsed=now()-started;
      if(!Number.isFinite(elapsed)||elapsed<0)
        throw Error('Invalid cache endurance observation time');
      const windowMs=Math.max(0.001,now()-lastWindowAt);
      if(windowLatency.count){
        const item=Object.freeze({
          elapsedMs:Math.round(elapsed*1000)/1000,
          latency:windowLatency.summarize(windowMs)
        });
        windows.push(item);
        onWindow(item);
      }
      if(windows.length>256)
        throw Error('Cache endurance window evidence exceeded fixed bound');
      windowLatency=new BoundedLatencySamples(1024);
      lastWindowAt=now();
      memory.record(elapsed,memoryUsage());
      progress.record(elapsed,completed);
    };
    stage('measured-queries');
    timer=setInterval(()=>{
      try{capture();}
      catch(error){samplingError=error;}
    },30000);
    timer.unref();
    await Promise.all(sessions.map((session,w)=>(async()=>{
      let local=0;
      while(now()-started<options.durationMs){
        if(samplingError)throw samplingError;
        if(issued>=options.maxOperations)
          throw Error('Cache endurance reached operation limit before duration');
        const id=issued++;
        const isChurn=local++%32===31;
        const begin=now();
        const result=await session.query(
          isChurn?CACHE_CHURN_SQL:CACHE_HOT_SQL,[id]);
        const elapsed=now()-begin;
        if(result.rows[0]?.value!==BigInt(id)||
          !Number.isFinite(elapsed)||elapsed<0)
          throw Error('Incorrect verified native cache query result or duration');
        allLatency.record(elapsed);
        windowLatency.record(elapsed);
        if(isChurn){churnLatency.record(elapsed);churn++;workers[w].churn++;}
        else{hotLatency.record(elapsed);hot++;workers[w].hot++;}
        completed++;
      }
    })()));
    clearInterval(timer);timer=undefined;
    if(samplingError)throw samplingError;
    stage('final-sampling');
    capture();
    const elapsed=now()-started;
    if(elapsed<options.durationMs||completed!==issued||
      hot+churn!==completed||hot<8||churn<8||
      workers.some(w=>w.hot===0||w.churn===0))
      throw Error('Incomplete cache endurance duration, worker coverage or results');
    await inspectCount(8,'after workload');
    const memoryTimeline=memory.summary();
    const progressTimeline=progress.summary();
    const memoryEvidence=validateMemoryTimeline(memoryTimeline,
      {minDurationMs:options.durationMs});
    const progressEvidence=validateProgressTimeline(progressTimeline,{
      minDurationMs:options.durationMs,expectedCompleted:completed,
      memoryTimeline
    });
    stage('closing-sessions');
    const closed=await Promise.allSettled(sessions.map(s=>s.close()));
    if(closed.some(x=>x.status==='rejected'))
      throw Error('Failed native cache session close');
    stage('release-census');
    await waitForZero(inspect);
    gc();
    const afterCloseGc=memoryUsage();
    completedRun=true;
    stage('completed');
    return Object.freeze({
      elapsedMs:elapsed,completed,hot,churn,workers,
      latency:allLatency.summarize(elapsed),
      hotLatency:hotLatency.summarize(elapsed),
      churnLatency:churnLatency.summarize(elapsed),
      windows,memoryTimeline,progressTimeline,memoryEvidence,progressEvidence,
      postWarmupGc:{
        heapUsed:postWarmupGc.heapUsed,rss:postWarmupGc.rss,
        external:postWarmupGc.external,arrayBuffers:postWarmupGc.arrayBuffers
      },
      afterCloseGc:{
        heapUsed:afterCloseGc.heapUsed,rss:afterCloseGc.rss,
        external:afterCloseGc.external,arrayBuffers:afterCloseGc.arrayBuffers
      },
      preparedAfterWarmup:8,preparedAfterWork:8,preparedAfterClose:0,
      samplingPeriodMs:30000,windowLatencySampleCapacity:1024,
      overallLatencySampleCapacity:4096,
      measurement:'bounded reservoir latency p95/p99 and process-level memory; no leak attribution'
    });
  }finally{
    if(timer)clearInterval(timer);
    // Preserve the actual failed phase in redacted CI evidence.
    const outcomes=await Promise.allSettled(sessions.map(s=>s.close()));
    if(outcomes.some(x=>x.status==='rejected'))
      throw Error('Native cache endurance cleanup failed');
    if(!completedRun)await waitForZero(inspect);
  }
}
