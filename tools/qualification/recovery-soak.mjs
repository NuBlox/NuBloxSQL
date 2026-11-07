/**
 * Opt-in extended native MySQL memory recovery evidence.
 *
 * Repeats validated single- and multi-result queries on one physical
 * connection, releases all data at each async boundary, and samples only
 * post-GC process memory. It cannot prove the absence of memory leaks.
 */
import {performance} from 'node:perf_hooks';
import {executeAndRelease,liveRetentionScenarios}
  from './live-retention.mjs';

const METRICS=Object.freeze(['heapUsed','rss','external','arrayBuffers']);
const MAX_SELECTED_BYTES=512*1024*1024;

export function recoverySoakOptions(raw={}){
  if(raw===null||typeof raw!=='object'||Array.isArray(raw)||
     Object.keys(raw).some(key=>!['rows','rowBytes','cycles',
       'checkpointEvery'].includes(key)))
    throw new TypeError('Invalid MySQL recovery soak options');
  const limits={
    rows:[20,500,250],rowBytes:[256,4096,2048],
    cycles:[16,128,64],checkpointEvery:[1,32,8]
  };
  const options={};
  for(const [key,[min,max,fallback]] of Object.entries(limits)){
    const value=raw[key]??fallback;
    if(!Number.isSafeInteger(value)||value<min||value>max)
      throw new RangeError('Invalid MySQL recovery soak '+key);
    options[key]=value;
  }
  if(options.cycles%options.checkpointEvery!==0||
     options.cycles/options.checkpointEvery<4||
     (options.cycles/options.checkpointEvery)%2!==0)
    throw new RangeError('Recovery soak needs at least four even, evenly spaced checkpoints');
  // Two workload shapes, each returning a row of text and a binary value.
  // Worst-case total selected field payload remains bounded across the run.
  if(options.rows*options.rowBytes*4*options.cycles>MAX_SELECTED_BYTES)
    throw new RangeError('Recovery soak selected payload exceeds 512 MiB limit');
  return Object.freeze(options);
}

function snapshot(memoryUsage){
  const raw=memoryUsage();
  const result={};
  for(const metric of METRICS){
    const value=raw?.[metric];
    if(!Number.isSafeInteger(value)||value<0)
      throw new Error('Invalid MySQL recovery soak memory measurement');
    result[metric]=value;
  }
  return result;
}

function median(values){
  const ordered=[...values].sort((a,b)=>a-b);
  const index=Math.floor(ordered.length/2);
  return ordered.length%2?ordered[index]:
    (ordered[index-1]+ordered[index])/2;
}

/** Report signed drift; deliberately do not threshold on CI noise. */
export function summarizeRecoveryCheckpoints(checkpoints){
  if(!Array.isArray(checkpoints)||checkpoints.length<5)
    throw new Error('Recovery soak needs a baseline and four checkpoints');
  if(checkpoints[0]?.cycle!==0)
    throw new Error('Recovery soak baseline must be cycle zero');
  const sampling=checkpoints.slice(1);
  if(sampling.length%2!==0)
    throw new Error('Recovery soak needs paired early and late checkpoints');
  let previous=0;
  for(const point of sampling){
    if(!Number.isSafeInteger(point?.cycle)||point.cycle<=previous)
      throw new Error('Invalid MySQL recovery soak checkpoint ordering');
    previous=point.cycle;
  }
  const mid=sampling.length/2;
  const summary={};
  for(const metric of METRICS){
    const values=checkpoints.map(point=>point?.memory?.[metric]);
    if(values.some(value=>!Number.isSafeInteger(value)||value<0))
      throw new Error('Invalid MySQL recovery soak checkpoint memory');
    const early=median(values.slice(1,mid+1));
    const late=median(values.slice(mid+1));
    summary[metric]={
      baselineBytes:values[0],
      lastBytes:values.at(-1),
      firstToLastDeltaBytes:values.at(-1)-values[0],
      earlyMedianBytes:early,
      lateMedianBytes:late,
      earlyToLateMedianDeltaBytes:late-early,
      minPostGcBytes:Math.min(...values.slice(1)),
      maxPostGcBytes:Math.max(...values.slice(1))
    };
  }
  return summary;
}

async function sessionIdentity(db){
  const result=await db.query('SELECT CONNECTION_ID() AS qualification_connection_id');
  const id=result?.rows?.[0]?.qualification_connection_id;
  if((typeof id!=='number'&&typeof id!=='bigint')||
     (typeof id==='number'&&!Number.isSafeInteger(id))||
     id<=0)
    throw new Error('Invalid MySQL recovery soak connection identity');
  return String(id);
}

/** Only numerical counts escape the async scope that owns result objects. */
async function warmup(db,scenarios){
  for(const scenario of scenarios)await executeAndRelease(db,scenario);
}

export async function profileRecoverySoak({
  connect,target,options={},gc=global.gc,
  memoryUsage=process.memoryUsage,now=()=>performance.now()
}={}){
  const config=recoverySoakOptions(options);
  if(typeof connect!=='function'||!target||
     typeof gc!=='function'||typeof memoryUsage!=='function'||
     typeof now!=='function')
    throw new Error('Recovery soak requires isolated MySQL and --expose-gc');
  const scenarios=liveRetentionScenarios(config);
  const cases=[scenarios[0],scenarios[2]];
  const db=await connect(target);
  try{
    if(typeof db?.query!=='function'||typeof db.queryResults!=='function'||
       typeof db.close!=='function'||typeof db.info?.version!=='string')
      throw new Error('Invalid recovery soak database connection');
    const identity=await sessionIdentity(db);
    await warmup(db,cases);
    gc();
    const checkpoints=[{cycle:0,memory:snapshot(memoryUsage)}];
    let operations=0,validatedRows=0,validatedResultSets=0;
    const start=now();
    for(let cycle=1;cycle<=config.cycles;cycle++){
      // Alternate order to reduce cross-scenario cache/order bias.
      const order=cycle%2?cases:[cases[1],cases[0]];
      for(const scenario of order){
        const counts=await executeAndRelease(db,scenario);
        if(counts.rows!==(scenario.name==='textBlobRows'?
           config.rows:2*config.rows)||
           counts.resultSets!==(scenario.name==='textBlobRows'?1:3))
          throw new Error('Invalid MySQL recovery soak result cardinality');
        operations++;
        validatedRows+=counts.rows;
        validatedResultSets+=counts.resultSets;
      }
      if(cycle%config.checkpointEvery===0){
        if(await sessionIdentity(db)!==identity)
          throw new Error('MySQL recovery soak connection changed');
        gc();
        checkpoints.push({cycle,memory:snapshot(memoryUsage)});
      }
    }
    const elapsedMs=now()-start;
    if(!Number.isFinite(elapsedMs)||elapsedMs<=0)
      throw new Error('Invalid MySQL recovery soak elapsed time');
    if(operations!==config.cycles*2||
       checkpoints.length!==config.cycles/config.checkpointEvery+1)
      throw new Error('Incomplete MySQL recovery soak qualification');
    return {
      schemaVersion:1,kind:'mysql-sustained-recovery-profile',
      serverVersion:db.info.version,options:config,
      cyclesCompleted:config.cycles,
      operationsCompleted:operations,
      rowsValidated:validatedRows,
      resultSetsValidated:validatedResultSets,
      elapsedMs:Number(elapsedMs.toFixed(3)),
      sessionContinuityVerified:true,
      checkpoints,postGcTrend:summarizeRecoveryCheckpoints(checkpoints),
      measurement:'forced GC at baseline and evenly spaced recovery checkpoints',
      limitations:[
        'Post-GC process memory is not exact driver allocation attribution',
        'Heap, RSS, external and ArrayBuffer values overlap and must not be summed',
        'V8 can retain capacity; signed growth does not alone demonstrate a leak',
        'Observed stability over a bounded run cannot establish long-term leak freedom',
        'This isolated read-only workload is not production traffic or a release gate'
      ]
    };
  }finally{await db.close();}
}
