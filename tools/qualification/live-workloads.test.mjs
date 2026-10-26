import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseLiveOptions,profileLiveWorkloads} from './live-workloads.mjs';

test('live profiling options reject malformed, duplicated and unbounded inputs',()=>{
  const defaults=parseLiveOptions([]);
  assert.equal(defaults.samples,30);
  assert.equal(defaults.rowBytes,4096);
  assert.ok(Object.isFrozen(defaults));
  assert.equal(parseLiveOptions(['--samples=8','--rows=256']).rows,256);
  for(const args of [
    ['--samples=2'],['--concurrency=0'],['--rows=1001'],
    ['--unknown=2'],['--samples=5','--samples=7'],['--rows=1.5'],
    ['--durationMs=499'],['--maxOperations=9999999']
  ])assert.throws(()=>parseLiveOptions(args));
});

test('real workload orchestration validates results, bounded pool and cleanup with fakes',{timeout:4000},async()=>{
  let closed=0,preparedClosed=0,poolClosed=0,created=0;
  const connection=()=>({
    info:{version:'fixture-8.4'},
    async prepare(){
      return {
        async execute([n]){return {rows:[{sample_value:BigInt(n)}]};},
        async close(){preparedClosed++;}
      };
    },
    async query(sql,args){
      if(sql.startsWith('SELECT a.n')){
        const [rowBytes,rows]=args;
        const records=Array.from({length:rows},(_,i)=>({
          ordinal:BigInt(i),payload:'x'.repeat(rowBytes)
        }));
        return {rows:records,rowValues:records.map(r=>[r.ordinal,r.payload])};
      }
      return {rows:[{sample_value:BigInt(args[0])}]};
    },
    async close(){closed++;}
  });
  const createPool=(_,options)=>{
    assert.equal(options.maxConnections,2);
    const db=connection();
    let open=true;
    return {
      get stats(){return {size:open?1:0,pending:0};},
      async withConnection(fn){return fn(db);},
      async close(){open=false;poolClosed++;}
    };
  };
  const options=parseLiveOptions([
    '--samples=3','--rows=100','--rowBytes=256',
    '--concurrency=2','--durationMs=500','--maxOperations=1000000'
  ]);
  const report=await profileLiveWorkloads({
    connect:async()=>{created++;return connection();},createPool,
    target:{engine:'mysql'},options
  });
  assert.equal(report.serverVersion,'fixture-8.4');
  assert.equal(report.workloads.prepared.count,3);
  assert.equal(report.workloads.largeResults.rowsPerQuery,100);
  assert.equal(report.workloads.largeResults.validatedPayloadBytes,3*100*256);
  assert.ok(report.workloads.concurrent.completed>=2);
  assert.ok(report.workloads.concurrent.elapsedMs>=500);
  assert.equal(created,2);
  assert.equal(closed,2);
  assert.equal(preparedClosed,1);
  assert.equal(poolClosed,1);
  for(const stage of Object.values(report.resources)){
    assert.ok(stage.heapUsedPeakBytes>0);
    assert.ok(stage.rssPeakBytes>0);
    assert.ok(stage.userCpuMs>=0);
  }
});
