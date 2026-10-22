import {test} from 'node:test';
import assert from 'node:assert/strict';
import {integerOption,quantile,summarize,parseArgs,safeError} from './metrics.mjs';

test('deterministic nearest-rank latency percentiles and throughput',()=>{
  const stats=summarize([5,1,9,3,7],500);
  assert.deepEqual(stats,{
    count:5,elapsedMs:500,operationsPerSecond:10,
    minMs:1,p50Ms:5,p95Ms:9,p99Ms:9,maxMs:9
  });
  assert.equal(quantile([],0.95),null);
  assert.equal(quantile([1,2,3,4],0),1);
  assert.equal(quantile([1,2,3,4],1),4);
  assert.equal(summarize([],20).p95Ms,null);
  assert.ok(Object.isFrozen(stats));
});
test('CLI rejects unbounded or malformed qualification workloads',()=>{
  assert.deepEqual(parseArgs(['--iterations=2','--concurrency=3','--cursorRows=100'], 'benchmark'),{
    mode:'benchmark',iterations:2,concurrency:3,durationMs:8000,fetchSize:32,cursorRows:100
  });
  for(const bad of [
    ['--concurrency=0'],['--concurrency=17'],['--iterations=50001'],
    ['--durationMs=0'],['--durationMs=600001'],['--fetchSize=257'],
    ['--cursorRows=99'],['--foo=2'],['--concurrency=2','--concurrency=3'],
    ['--iterations=NaN'],['--iterations=-1']
  ])assert.throws(()=>parseArgs(bad,'soak'));
  assert.throws(()=>parseArgs([], 'unknown'));
  assert.throws(()=>integerOption(1.5,{name:'x',min:1,max:10}));
});
test('metric inputs are validated and errors redact text and secrets',()=>{
  for(const value of [-1,NaN,Infinity])
    assert.throws(()=>summarize([value],100));
  assert.throws(()=>summarize([1],0));
  assert.throws(()=>quantile([1],1.01));
  assert.equal(safeError({code:'DATABASE_ERROR',message:'credentials leaked'}),'DATABASE_ERROR');
  assert.equal(safeError({code:'password-super-secret'}),'UNCLASSIFIED_ERROR');
  assert.equal(safeError(Error('a leaked password')),'UNCLASSIFIED_ERROR');
});
