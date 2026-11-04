import assert from 'node:assert/strict';
import {summarize} from './metrics.mjs';

const round=n=>Math.round(n*1000)/1000;
const memoryFields=['heapUsed','rss','external','arrayBuffers'];
const median=values=>{
  const sorted=[...values].sort((a,b)=>a-b);
  const middle=Math.floor(sorted.length/2);
  return sorted.length%2===0
    ?(sorted[middle-1]+sorted[middle])/2:sorted[middle];
};

/** A bounded, uniformly replaced latency reservoir. All operations count
 * towards throughput; only a fixed number of samples are retained for
 * approximate latency percentiles. No new dependency or production hook. */
export class BoundedLatencySamples {
  #samples=[];
  #count=0;
  #min=Infinity;
  #max=0;
  #state=0x13579bdf;
  constructor(capacity=4096){
    assert.ok(Number.isSafeInteger(capacity)&&capacity>=2&&capacity<=65536);
    this.capacity=capacity;
  }
  record(ms){
    assert.ok(Number.isFinite(ms)&&ms>=0,'Invalid latency');
    this.#count++;
    this.#min=Math.min(this.#min,ms);
    this.#max=Math.max(this.#max,ms);
    if(this.#samples.length<this.capacity){
      this.#samples.push(ms);
    }else{
      this.#state=(Math.imul(this.#state,1664525)+1013904223)>>>0;
      const replacement=Math.floor(this.#state/0x100000000*this.#count);
      if(replacement<this.capacity)this.#samples[replacement]=ms;
    }
  }
  summarize(elapsedMs){
    const stats=summarize(this.#samples,elapsedMs);
    return Object.freeze({
      ...stats,count:this.#count,
      operationsPerSecond:round(this.#count*1000/elapsedMs),
      minMs:this.#count?round(this.#min):null,
      maxMs:this.#count?round(this.#max):null,
      percentileMethod:'bounded-reservoir-nearest-rank',
      latencySamples:this.#samples.length,
      latencySampleCapacity:this.capacity
    });
  }
  get count(){return this.#count;}
}

/** Bounded process-memory observations taken only during pooled work.
 * This observes V8/process residency; it cannot attribute retained objects
 * or distinguish all garbage-collector and allocator effects from leaks. */
export class BoundedMemoryTimeline {
  #samples=[];
  constructor({intervalMs=30000,capacity=256}={}){
    assert.ok(Number.isSafeInteger(intervalMs)&&intervalMs>=1000);
    assert.ok(Number.isSafeInteger(capacity)&&capacity>=4&&capacity<=1024);
    this.intervalMs=intervalMs;
    this.capacity=capacity;
  }
  record(elapsedMs,memory){
    assert.ok(Number.isFinite(elapsedMs)&&elapsedMs>=0,'Invalid elapsed time');
    assert.ok(memory&&typeof memory==='object');
    const last=this.#samples.at(-1);
    if(last)assert.ok(elapsedMs>=last.elapsedMs,'Nonmonotonic memory timestamp');
    assert.ok(this.#samples.length<this.capacity,'Memory trace exceeded bounded capacity');
    const sample={elapsedMs:round(elapsedMs)};
    for(const field of memoryFields){
      assert.ok(Number.isSafeInteger(memory[field])&&memory[field]>=0,
        'Invalid memory metric: '+field);
      sample[field+'Bytes']=memory[field];
    }
    this.#samples.push(sample);
  }
  summary(){
    assert.ok(this.#samples.length>=2,'Insufficient memory samples');
    const samples=this.#samples.map(value=>Object.freeze({...value}));
    const windowSize=Math.max(1,Math.floor(samples.length/5));
    const first=samples.slice(0,windowSize),last=samples.slice(-windowSize);
    const growth=field=>Math.round(
      median(last.map(s=>s[field]))-median(first.map(s=>s[field])));
    const trend=Object.freeze({
      windowSamples:windowSize,
      heapUsedGrowthBytes:growth('heapUsedBytes'),
      rssGrowthBytes:growth('rssBytes')
    });
    return Object.freeze({
      kind:'pooled-memory-timeline',intervalMs:this.intervalMs,
      capacity:this.capacity,count:samples.length,
      samples:Object.freeze(samples),trend
    });
  }
}

/** Validate persisted observations; independently recompute the trend. */
export function validateMemoryTimeline(trace,{minDurationMs=0}={}){
  assert.ok(trace?.kind==='pooled-memory-timeline'&&
    trace.intervalMs===30000&&trace.capacity===256&&
    Number.isSafeInteger(trace.count)&&trace.count>=2&&
    trace.count<=trace.capacity&&Array.isArray(trace.samples)&&
    trace.samples.length===trace.count,'Invalid bounded memory timeline');
  const verifier=new BoundedMemoryTimeline({
    intervalMs:trace.intervalMs,capacity:trace.capacity
  });
  for(const sample of trace.samples){
    assert.ok(sample&&typeof sample==='object');
    const memory=Object.fromEntries(memoryFields.map(field=>
      [field,sample[field+'Bytes']]));
    verifier.record(sample.elapsedMs,memory);
  }
  const verified=verifier.summary();
  assert.deepEqual(trace.trend,verified.trend,'Mismatched memory trend');
  const first=trace.samples[0],last=trace.samples.at(-1);
  assert.ok(first.elapsedMs<=1000&&last.elapsedMs>=minDurationMs,
    'Incomplete pooled-memory observation window');
  // Validate the actual distribution of samples, not just their total
  // count. Without an inter-sample bound, many samples clustered at the
  // beginning plus one final sample can falsely claim continuous coverage.
  let maxSampleGapMs=0;
  for(let i=1;i<trace.samples.length;i++){
    const gap=trace.samples[i].elapsedMs-trace.samples[i-1].elapsedMs;
    maxSampleGapMs=Math.max(maxSampleGapMs,gap);
    if(minDurationMs>=1_800_000)
      assert.ok(gap>0&&gap<=3*trace.intervalMs,
        'Long-running memory trace contains a missing observation window');
  }
  // Short smoke tests have a start/end pair without scheduled intermediate
  // samples. Only endurance evidence enforces uninterrupted observation.
  if(minDurationMs>=1_800_000){
    assert.ok(trace.count>=Math.floor(minDurationMs/trace.intervalMs*0.75),
      'Insufficient duration-wide memory observations');
  }
  // Conservative guardrails: a trip warrants investigation, not automatic
  // attribution to a driver memory leak.
  assert.ok(trace.trend.heapUsedGrowthBytes<=128*1024*1024&&
    trace.trend.rssGrowthBytes<=256*1024*1024,
    'Sustained memory-growth guardrail exceeded');
  return Object.freeze({
    samples:trace.count,
    heapUsedGrowthBytes:trace.trend.heapUsedGrowthBytes,
    rssGrowthBytes:trace.trend.rssGrowthBytes,
    observationElapsedMs:last.elapsedMs-first.elapsedMs,
    maxSampleGapMs
  });
}

/** Bounded successful-SQL-progress samples, excluding attempted or unverified
 * work. Records contain only aggregate counters and monotonic elapsed time. */
export class BoundedProgressTimeline {
  #samples=[];
  constructor({intervalMs=30000,capacity=256}={}){
    assert.ok(Number.isSafeInteger(intervalMs)&&intervalMs>=1000);
    assert.ok(Number.isSafeInteger(capacity)&&capacity>=4&&capacity<=1024);
    this.intervalMs=intervalMs;
    this.capacity=capacity;
  }
  record(elapsedMs,completed){
    assert.ok(Number.isFinite(elapsedMs)&&elapsedMs>=0,'Invalid SQL progress timestamp');
    assert.ok(Number.isSafeInteger(completed)&&completed>=0,
      'Invalid completed SQL operation counter');
    const last=this.#samples.at(-1);
    if(last)assert.ok(elapsedMs>=last.elapsedMs&&completed>=last.completed,
      'Nonmonotonic SQL progress');
    assert.ok(this.#samples.length<this.capacity,'SQL progress trace exceeds capacity');
    this.#samples.push({elapsedMs:round(elapsedMs),completed});
  }
  summary(){
    assert.ok(this.#samples.length>=2,'Insufficient SQL progress observations');
    const samples=this.#samples.map(sample=>Object.freeze({...sample}));
    let lastProgressAt=samples[0].elapsedMs,maxUnverifiedProgressMs=0;
    for(let i=1;i<samples.length;i++){
      const current=samples[i];
      maxUnverifiedProgressMs=Math.max(maxUnverifiedProgressMs,
        current.elapsedMs-lastProgressAt);
      if(current.completed>samples[i-1].completed)lastProgressAt=current.elapsedMs;
    }
    return Object.freeze({
      kind:'pooled-sql-progress-timeline',intervalMs:this.intervalMs,
      capacity:this.capacity,count:samples.length,
      samples:Object.freeze(samples),
      progress:Object.freeze({
        startCompleted:samples[0].completed,
        endCompleted:samples.at(-1).completed,
        maxUnverifiedProgressMs:round(maxUnverifiedProgressMs)
      })
    });
  }
}

/** Independently verify sampled SQL work against a verified workload total and
 * the same timestamps as the separately validated memory timeline. */
export function validateProgressTimeline(trace,{
  minDurationMs=0,expectedCompleted,memoryTimeline
}={}){
  assert.ok(trace?.kind==='pooled-sql-progress-timeline'&&
    trace.intervalMs===30000&&trace.capacity===256&&
    Number.isSafeInteger(trace.count)&&trace.count>=2&&
    trace.count<=trace.capacity&&Array.isArray(trace.samples)&&
    trace.samples.length===trace.count,'Invalid bounded SQL progress timeline');
  assert.ok(Number.isSafeInteger(expectedCompleted)&&expectedCompleted>=1,
    'Verified completed SQL work total is required');
  assert.ok(memoryTimeline?.kind==='pooled-memory-timeline'&&
    Array.isArray(memoryTimeline.samples)&&
    memoryTimeline.samples.length===trace.count,
    'SQL progress observations must match memory observation count');
  const verifier=new BoundedProgressTimeline({
    intervalMs:trace.intervalMs,capacity:trace.capacity
  });
  for(let i=0;i<trace.samples.length;i++){
    const sample=trace.samples[i];
    assert.ok(sample&&typeof sample==='object'&&
      sample.elapsedMs===memoryTimeline.samples[i]?.elapsedMs,
      'SQL progress observations must match memory timestamps');
    verifier.record(sample.elapsedMs,sample.completed);
  }
  const recalculated=verifier.summary();
  assert.deepEqual(trace.progress,recalculated.progress,
    'SQL progress metadata fails independent recalculation');
  const first=trace.samples[0],last=trace.samples.at(-1);
  assert.ok(first.elapsedMs<=1000&&last.elapsedMs>=minDurationMs&&
    first.completed===0&&last.completed===expectedCompleted,
    'Incomplete SQL progress observations or mismatched total');
  if(minDurationMs>=1_800_000){
    assert.ok(trace.count>=Math.floor(minDurationMs/trace.intervalMs*0.75),
      'Missing sustained SQL progress observations');
    assert.ok(recalculated.progress.maxUnverifiedProgressMs<=3*trace.intervalMs,
      'Sustained SQL workload has a gap without confirmed progress');
  }
  return Object.freeze({
    samples:trace.count,completed:expectedCompleted,
    maxUnverifiedProgressMs:recalculated.progress.maxUnverifiedProgressMs,
    observedDurationMs:last.elapsedMs-first.elapsedMs
  });
}
