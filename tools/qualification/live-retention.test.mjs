import {test} from 'node:test';
import assert from 'node:assert/strict';
import {liveRetentionOptions,profileLiveRetention} from './live-retention.mjs';

const column=(name,type=8,charset=63)=>({
  name,schema:'',table:'',originalTable:'',originalName:'',
  type,charset,length:4096,flags:0,decimals:0,unsigned:false
});

function fixture({badPayload=false,badMulti=false,badLarge=false}={}){
  let queries=0,closed=0;
  const connection={
    info:{version:'8.4-fixture'},
    async query(sql,params){
      assert.match(sql,/^SELECT a\.n\+10\*b\.n/);
      const [textBytes,binaryBytes,rows]=params;
      assert.equal(textBytes,binaryBytes);
      queries++;
      const columns=[
        column('ordinal'),column('text_value',253,45),
        column('binary_value',252,63)
      ];
      const records=Array.from({length:rows},(_,i)=>({
        ordinal:BigInt(i),text_value:'x'.repeat(textBytes),
        binary_value:Buffer.alloc(binaryBytes,0x79)
      }));
      if(badPayload)records[0].binary_value=Buffer.from([0x00]);
      return {
        columns,columnKeys:columns.map(c=>c.name),
        rows:records,
        rowValues:records.map(row=>
          [row.ordinal,row.text_value,row.binary_value])
      };
    },
    async queryResults(sql,params){
      if(sql==='CALL nublox_memory_results(?,?)'){
        const [rows,rowBytes]=params;
        queries++;
        const text='x'.repeat(rowBytes);
        const binary=Buffer.alloc(rowBytes,0x79);
        const texts=Array.from({length:rows},(_,i)=>({
          ordinal:BigInt(i),text_value:text
        }));
        const blobs=Array.from({length:rows},(_,i)=>({
          ordinal:BigInt(i),binary_value:Buffer.from(binary)
        }));
        if(badLarge)blobs[0].binary_value=Buffer.from([0]);
        return [
          {columns:[column('ordinal'),column('text_value',253,45)],
            columnKeys:['ordinal','text_value'],rows:texts,
            rowValues:texts.map(row=>[row.ordinal,row.text_value])},
          {columns:[column('ordinal'),column('binary_value',252,63)],
            columnKeys:['ordinal','binary_value'],rows:blobs,
            rowValues:blobs.map(row=>[row.ordinal,row.binary_value])},
          {columns:[],rows:[],rowValues:[]}
        ];
      }
      assert.equal(sql,'CALL nublox_multi_result(?)');
      assert.deepEqual(params,[41]);queries++;
      return [
        {columns:[column('initial_value'),column('label',253,45)],
          columnKeys:['initial_value','label'],
          rows:[{initial_value:badMulti?40n:41n,label:'first'}],
          rowValues:[[badMulti?40n:41n,'first']]},
        {columns:[column('second_value')],columnKeys:['second_value'],
          rows:[{second_value:42n}],rowValues:[[42n]]},
        {columns:[],rows:[],rowValues:[]}
      ];
    },
    async close(){closed++;}
  };
  return {connection,get queries(){return queries;},
    get closed(){return closed;}};
}

test('live retention configuration is bounded and strictly typed',()=>{
  assert.deepEqual(liveRetentionOptions({rows:20,rowBytes:256,rounds:2,recoveryCycles:3}),
    {rows:20,rowBytes:256,rounds:2,recoveryCycles:3});
  assert.ok(Object.isFrozen(liveRetentionOptions()));
  for(const [key,values] of Object.entries({
    rows:[0,19,501,NaN,'250',Infinity],
    rowBytes:[0,255,4097,0.5,'2048'],
    rounds:[0,1,5,1.2,'3'],
    recoveryCycles:[0,2,25,1.2,'8',Infinity]
  })){
    for(const value of values)
      assert.throws(()=>liveRetentionOptions({[key]:value}),
        /Invalid live retention profile/);
  }
  assert.throws(()=>liveRetentionOptions(null));
  assert.throws(()=>liveRetentionOptions([]));
  assert.throws(()=>liveRetentionOptions({unknown:1}));
});

test('live retention requires explicit GC and a connection factory',async()=>{
  await assert.rejects(profileLiveRetention({
    connect:null,target:{engine:'mysql'},options:{rows:20,rowBytes:256,rounds:2},
    gc:()=>{}
  }),/requires connection and --expose-gc/);
  await assert.rejects(profileLiveRetention({
    connect:async()=>fixture().connection,target:{engine:'mysql'},
    options:{rows:20,rowBytes:256,rounds:2},gc:null
  }),/requires connection and --expose-gc/);
});

test('real-result orchestration holds both representations and reports separate memory deltas',async()=>{
  const fake=fixture();
  let tick=0;
  const report=await profileLiveRetention({
    connect:async()=>fake.connection,
    target:{engine:'mysql'},
    options:{rows:20,rowBytes:256,rounds:2,recoveryCycles:3},
    gc:global.gc??(()=>{}),
    memoryUsage:process.memoryUsage,
    now:()=>++tick
  });
  assert.equal(report.kind,'mysql-live-result-retention-profile');
  assert.equal(report.serverVersion,'8.4-fixture');
  assert.equal(report.schemaVersion,2);
  assert.equal(report.samples.length,6);
  assert.deepEqual(report.samples.map(s=>s.scenario),[
    'textBlobRows','storedProcedureMultiResult','largeMultiResultRows',
    'storedProcedureMultiResult','largeMultiResultRows','textBlobRows'
  ]);
  assert.equal(fake.queries,15,
    'three warmups, six retained samples, six recovery cycles');
  assert.equal(fake.closed,1);
  for(const sample of report.samples){
    assert.ok(sample.estimatedRetainedBytes>0);
    assert.equal(sample.elapsedMs,1);
    assert.equal(sample.resultSets,
      sample.scenario==='textBlobRows'?1:3);
    if(sample.scenario==='largeMultiResultRows'){
      assert.equal(sample.rows,40);
      assert.equal(sample.cells,80);
      assert.equal(sample.expectedPayloadBytes,20*256*2);
    }else if(sample.scenario==='textBlobRows'){
      assert.equal(sample.rows,20);
      assert.equal(sample.cells,60);
      assert.equal(sample.expectedPayloadBytes,20*256*2);
    }else{
      assert.equal(sample.rows,2);
      assert.equal(sample.expectedPayloadBytes,0);
    }
    for(const key of ['heapUsed','rss','external','arrayBuffers']){
      assert.equal(sample.deltaBytes[key],
        sample.after[key]-sample.before[key]);
      assert.ok(Number.isSafeInteger(sample.deltaBytes[key]));
    }
  }
  assert.equal(report.recovery.length,2);
  assert.deepEqual(report.recovery.map(r=>r.scenario),
    ['textBlobRows','largeMultiResultRows']);
  for(const recovery of report.recovery){
    assert.equal(recovery.cycles.length,3);
    for(const [i,cycle] of recovery.cycles.entries()){
      assert.equal(cycle.cycle,i+1);
      assert.equal(cycle.rows,
        recovery.scenario==='textBlobRows'?20:40);
      for(const key of ['heapUsed','rss','external','arrayBuffers']){
        assert.equal(cycle.deltaBytes[key],
          cycle.after[key]-cycle.before[key]);
        assert.ok(Number.isSafeInteger(cycle.deltaBytes[key]));
      }
    }
    for(const key of ['heapUsed','rss','external','arrayBuffers'])
      assert.equal(recovery.firstToLastPostGcDeltaBytes[key],
        recovery.cycles.at(-1).after[key]-recovery.cycles[0].after[key]);
  }
  assert.ok(!JSON.stringify(report).includes('test-password'));
  assert.ok(!JSON.stringify(report).includes('REPEAT('));
});

test('incorrect text/BLOB or multi-result outputs fail before publishing evidence',async()=>{
  for(const invalid of [{badPayload:true},{badMulti:true},{badLarge:true}]){
    const fake=fixture(invalid);
    await assert.rejects(profileLiveRetention({
      connect:async()=>fake.connection,target:{engine:'mysql'},
      options:{rows:20,rowBytes:256,rounds:2},
      gc:()=>{},memoryUsage:process.memoryUsage
    }),/Invalid live retention/);
    assert.equal(fake.closed,1);
  }
});

test('invalid memory metrics fail closed and still release the session',async()=>{
  const fake=fixture();
  await assert.rejects(profileLiveRetention({
    connect:async()=>fake.connection,target:{engine:'mysql'},
    options:{rows:20,rowBytes:256,rounds:2},
    gc:()=>{},memoryUsage:()=>({heapUsed:-1,rss:0,external:0,arrayBuffers:0})
  }),/Invalid live retention memory measurement/);
  assert.equal(fake.closed,1);
});
