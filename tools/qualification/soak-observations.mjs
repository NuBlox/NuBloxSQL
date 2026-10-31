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
  // Missed sampler ticks fail rather than silently claiming dense coverage.
  if(minDurationMs>=1_800_000){
    assert.ok(trace.count>=Math.floor(minDurationMs/30000*0.75),
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
    observationElapsedMs:last.elapsedMs-first.elapsedMs
  });
}
