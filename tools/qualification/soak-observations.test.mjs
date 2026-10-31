import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BoundedLatencySamples,BoundedMemoryTimeline,validateMemoryTimeline}
  from './soak-observations.mjs';

test('soak latency memory is bounded while reporting the true throughput count',()=>{
  const sampler=new BoundedLatencySamples(64);
  for(let i=0;i<100_000;i++)sampler.record(i%200+0.25);
  const report=sampler.summarize(5000);
  assert.equal(report.count,100_000);
  assert.equal(report.operationsPerSecond,20_000);
  assert.equal(report.latencySamples,64);
  assert.equal(report.latencySampleCapacity,64);
  assert.equal(report.minMs,0.25);
  assert.equal(report.maxMs,199.25);
  assert.equal(report.percentileMethod,'bounded-reservoir-nearest-rank');
  assert.ok(report.p99Ms>=report.p50Ms);
  assert.ok(Object.isFrozen(report));
});
test('deterministic seeded reservoir and input validation',()=>{
  const a=new BoundedLatencySamples(16),b=new BoundedLatencySamples(16);
  for(let i=0;i<5000;i++){a.record(i);b.record(i);}
  assert.deepEqual(a.summarize(123),b.summarize(123));
  for(const value of [-1,NaN,Infinity,-Infinity,'3'])
    assert.throws(()=>a.record(value));
  assert.throws(()=>new BoundedLatencySamples(1));
  assert.throws(()=>new BoundedLatencySamples(100000));
  const empty=new BoundedLatencySamples(8).summarize(100);
  assert.equal(empty.minMs,null);
  assert.equal(empty.maxMs,null);
  assert.equal(empty.count,0);
});
const mem=(heap,rss)=>({
  heapUsed:heap,rss,external:3_000_000,arrayBuffers:2_000_000
});
function fixture(durationMs=1_800_000,{heapStep=0,rssStep=0}={}){
  const timer=new BoundedMemoryTimeline();
  for(let t=0,i=0;t<=durationMs;t+=30000,i++)
    timer.record(t,mem(40_000_000+i*heapStep,90_000_000+i*rssStep));
  return timer.summary();
}
test('bounded sampled memory from full-duration series and independently derived trend',()=>{
  const trace=fixture(7_200_000);
  assert.equal(trace.count,241);
  assert.equal(trace.samples.length,241);
  assert.equal(trace.capacity,256);
  assert.equal(trace.intervalMs,30000);
  assert.ok(Object.isFrozen(trace));
  assert.ok(Object.isFrozen(trace.samples));
  assert.ok(Object.isFrozen(trace.samples[0]));
  const evidence=validateMemoryTimeline(trace,{minDurationMs:7_200_000});
  assert.equal(evidence.samples,241);
  assert.equal(evidence.heapUsedGrowthBytes,0);
  assert.equal(evidence.rssGrowthBytes,0);
  assert.equal(evidence.observationElapsedMs,7_200_000);
});
test('steady growth trips conservative guardrails, not silence or hard-coded claims',()=>{
  assert.throws(()=>validateMemoryTimeline(
    fixture(1_800_000,{heapStep:4_000_000}),
    {minDurationMs:1_800_000}),/guardrail/);
  assert.throws(()=>validateMemoryTimeline(
    fixture(1_800_000,{rssStep:8_000_000}),
    {minDurationMs:1_800_000}),/guardrail/);
  assert.doesNotThrow(()=>validateMemoryTimeline(
    fixture(1_800_000,{heapStep:100_000,rssStep:200_000}),
    {minDurationMs:1_800_000}));
});
test('missing, truncated and tampered timeline fails closed',()=>{
  assert.throws(()=>validateMemoryTimeline({}, {minDurationMs:1_800_000}));
  const short=fixture(1_800_000);
  const modified=structuredClone(short);
  modified.samples=modified.samples.slice(0,3);
  modified.count=3;
  assert.throws(()=>validateMemoryTimeline(modified,{minDurationMs:1_800_000}));
  const forged=structuredClone(short);
  forged.trend.heapUsedGrowthBytes=0xdeadbeef;
  assert.throws(()=>validateMemoryTimeline(forged,{minDurationMs:1_800_000}));
  const huge=structuredClone(short);
  huge.samples[0].heapUsedBytes=Infinity;
  assert.throws(()=>validateMemoryTimeline(huge,{minDurationMs:1_800_000}));
  const nonMonotonic=structuredClone(short);
  nonMonotonic.samples[4].elapsedMs=0;
  assert.throws(()=>validateMemoryTimeline(nonMonotonic,{minDurationMs:1_800_000}));
  const missing=structuredClone(short);
  missing.samples[2].rssBytes=undefined;
  assert.throws(()=>validateMemoryTimeline(missing,{minDurationMs:1_800_000}));
  const oversized=new BoundedMemoryTimeline({capacity:4});
  for(let i=0;i<4;i++)oversized.record(i*1000,mem(10000,20000));
  assert.throws(()=>oversized.record(5000,mem(10000,20000)),/capacity/);
});
