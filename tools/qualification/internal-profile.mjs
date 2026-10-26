/**
 * Dependency-free benchmark harness for isolated in-process driver stages.
 * Synthetic timings diagnose relative changes across commits, NOT wire latency
 * or vendor leadership. No production tracing hooks or client dependencies.
 */
import {performance} from 'node:perf_hooks';
import {summarize} from './metrics.mjs';

const STAGE_NAMES=Object.freeze([
  'asyncHarness','packetFraming','binaryRowDecode','serialPing','contendedPing'
]);

function integer(value,min,max,name){
  if(!Number.isSafeInteger(value)||value<min||value>max)
    throw new RangeError('Invalid '+name+' for internal profile');
  return value;
}

export function profileOptions(options={}){
  if(!options||typeof options!=='object')throw Error('Invalid internal profile configuration');
  return Object.freeze({
    iterations:integer(options.iterations??120,8,2000,'iterations'),
    rounds:integer(options.rounds??4,2,8,'rounds'),
    queueDepth:integer(options.queueDepth??8,2,16,'queueDepth')
  });
}

/** Each stage must return {operationsPerSample, sample(), close()}.
 * Correctness and cleanup are mandatory and excluded from timed loops.
 * The wall-clock throughput counts ALL work units (e.g. 128 decoded rows
 * per one timed sample). Sample percentiles represent whole sample groups. */
export async function profileInternalStages({
  stages,options={},now=()=>performance.now()
}){
  const config=profileOptions(options);
  if(!stages||typeof stages!=='object'||typeof now!=='function'||
    STAGE_NAMES.some(name=>typeof stages[name]!=='function'))
    throw Error('Missing internal profile stage factory');
  const trials=[];
  for(let round=1;round<=config.rounds;round++){
    // Rotate stage order to avoid favoring a single task through warmup,
    // CPU frequency changes or JIT recompilation throughout the session.
    const rotated=STAGE_NAMES.map((_,i)=>
      STAGE_NAMES[(i+round-1)%STAGE_NAMES.length]);
    for(const stageName of rotated){
      const stage=await stages[stageName](config);
      let cleanupError;
      try{
        if(typeof stage?.sample!=='function'||
          typeof stage?.close!=='function'||
          !Number.isSafeInteger(stage.operationsPerSample)||
          stage.operationsPerSample<1||stage.operationsPerSample>256)
          throw Error('Invalid internal benchmark stage');
        for(let i=0;i<12;i++)await stage.sample();
        const samples=[];
        const started=now();
        for(let i=0;i<config.iterations;i++){
          const start=now();
          await stage.sample();
          const duration=now()-start;
          if(!Number.isFinite(duration)||duration<0)
            throw Error('Invalid internal stage timing');
          samples.push(duration);
        }
        const elapsed=now()-started;
        const stats=summarize(samples,elapsed);
        const workUnits=config.iterations*stage.operationsPerSample;
        trials.push(Object.freeze({
          round,stage:stageName,
          operationsPerSample:stage.operationsPerSample,
          workUnits,
          ...stats,
          workUnitsPerSecond:Math.round(workUnits*1000/elapsed*1000)/1000
        }));
      }finally{
        try{await stage?.close?.();}catch(error){cleanupError=error;}
      }
      if(cleanupError)throw Error('Internal profiling stage cleanup failed');
    }
  }
  return Object.freeze({
    schemaVersion:1,
    kind:'mysql-native-internals-profile',
    isolation:'synthetic in-process; no database, network, or production tracing hooks',
    latencyUnit:'milliseconds per sample group (not per individual work unit)',
    conclusion:'diagnostic only; no cross-vendor performance comparison',
    configuration:config,
    trials
  });
}
