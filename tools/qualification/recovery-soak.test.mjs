import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  profileRecoverySoak,recoverySoakOptions,summarizeRecoveryCheckpoints
} from './recovery-soak.mjs';

const column=(name,type=8,charset=63)=>({
  name,schema:'',table:'',originalName:'',originalTable:'',
  type,charset,length:4096,flags:0,decimals:0,unsigned:false
});

function fixture({rotateConnection=false,badLarge=false,badIdentity=false}={}){
  let identityQueries=0,queries=0,closed=0;
  const connection={
    info:{version:'8.4-fixture'},
    async query(sql,args=[]){
      if(sql==='SELECT CONNECTION_ID() AS qualification_connection_id'){
        identityQueries++;
        return {rows:[{
          qualification_connection_id:badIdentity?'not-a-number':
            rotateConnection&&identityQueries>=3?102n:101n
        }]};
      }
      assert.match(sql,/^SELECT a\.n\+10\*b\.n/);
      const [length,binaryLength,count]=args;
      assert.equal(length,binaryLength);
      queries++;
      const rows=Array.from({length:count},(_,i)=>({
        ordinal:BigInt(i),text_value:'x'.repeat(length),
        binary_value:Buffer.alloc(length,0x79)
      }));
      return {
        columns:[column('ordinal'),column('text_value',253,45),
          column('binary_value',252,63)],
        columnKeys:['ordinal','text_value','binary_value'],
        rows,rowValues:rows.map(r=>[r.ordinal,r.text_value,r.binary_value])
      };
    },
    async queryResults(sql,args){
      assert.equal(sql,'CALL nublox_memory_results(?,?)');
      const [count,length]=args;queries++;
      const texts=Array.from({length:count},(_,i)=>({
        ordinal:BigInt(i),text_value:'x'.repeat(length)
      }));
      const binaries=Array.from({length:count},(_,i)=>({
        ordinal:BigInt(i),binary_value:Buffer.alloc(length,0x79)
      }));
      if(badLarge)binaries[0].binary_value=Buffer.alloc(length,0x00);
      return [
        {columns:[column('ordinal'),column('text_value',253,45)],
          columnKeys:['ordinal','text_value'],rows:texts,
          rowValues:texts.map(r=>[r.ordinal,r.text_value])},
        {columns:[column('ordinal'),column('binary_value',252,63)],
          columnKeys:['ordinal','binary_value'],rows:binaries,
          rowValues:binaries.map(r=>[r.ordinal,r.binary_value])},
        {columns:[],rows:[],rowValues:[]}
      ];
    },
    async close(){closed++;}
  };
  return {
    connection,
    get queries(){return queries;},
    get identityQueries(){return identityQueries;},
    get closed(){return closed;}
  };
}

test('sustained recovery options bound each workload and the whole run',()=>{
  assert.deepEqual(recoverySoakOptions({
    rows:20,rowBytes:256,cycles:16,checkpointEvery:4
  }),{rows:20,rowBytes:256,cycles:16,checkpointEvery:4});
  assert.ok(Object.isFrozen(recoverySoakOptions()));
  for(const args of [
    null,[],{unknown:1},{rows:'20'},{rows:19},{rows:501},
    {rowBytes:255},{rowBytes:4097},{cycles:15},{cycles:129},
    {checkpointEvery:0},{checkpointEvery:33},
    {cycles:17,checkpointEvery:4},
    {cycles:20,checkpointEvery:4}, // five checkpoints cannot split evenly
    {cycles:16,checkpointEvery:8}, // too few checkpoints
    {cycles:128,rows:500,rowBytes:4096,checkpointEvery:16}
  ])assert.throws(()=>recoverySoakOptions(args));
});

test('summary measures signed first/last and early/late post-GC trends',()=>{
  const checkpoints=[0,4,8,12,16].map((cycle,i)=>({
    cycle,memory:{
      heapUsed:[100,110,130,160,180][i],
      rss:[500,490,480,475,470][i],
      external:[200,250,220,225,210][i],
      arrayBuffers:[50,60,55,54,52][i]
    }
  }));
  const summary=summarizeRecoveryCheckpoints(checkpoints);
  assert.deepEqual(summary.heapUsed,{
    baselineBytes:100,lastBytes:180,firstToLastDeltaBytes:80,
    earlyMedianBytes:120,lateMedianBytes:170,
    earlyToLateMedianDeltaBytes:50,
    minPostGcBytes:110,maxPostGcBytes:180
  });
  assert.equal(summary.rss.firstToLastDeltaBytes,-30);
  assert.equal(summary.rss.earlyToLateMedianDeltaBytes,-12.5);
  assert.equal(summary.external.earlyToLateMedianDeltaBytes,-17.5);
});

test('summary rejects incomplete or corrupted checkpoint evidence',()=>{
  const base=[0,4,8,12,16].map(cycle=>({
    cycle,memory:{heapUsed:100,rss:200,external:300,arrayBuffers:400}
  }));
  assert.throws(()=>summarizeRecoveryCheckpoints([]),/baseline and four/);
  assert.throws(()=>summarizeRecoveryCheckpoints(base.slice(1)),/baseline/);
  assert.throws(()=>summarizeRecoveryCheckpoints(base.slice(0,4)),
    /baseline and four/);
  assert.throws(()=>summarizeRecoveryCheckpoints([
    ...base.slice(0,2),{...base[2],cycle:4},...base.slice(3)
  ]),/ordering/);
  assert.throws(()=>summarizeRecoveryCheckpoints([
    ...base.slice(0,4),{...base[4],memory:{...base[4].memory,heapUsed:-1}}
  ]),/memory/);
  assert.throws(()=>summarizeRecoveryCheckpoints([
    ...base,{...base[4],cycle:20}
  ]),/paired/);
});

test('sustained profile verifies one physical session and bounded memory checkpoints',async()=>{
  const f=fixture();
  let clock=0,memorySample=0,gcCount=0;
  const report=await profileRecoverySoak({
    connect:async()=>f.connection,target:{engine:'mysql'},
    options:{rows:20,rowBytes:256,cycles:16,checkpointEvery:4},
    gc:()=>{gcCount++;},
    now:()=>++clock,
    memoryUsage:()=>{
      const n=++memorySample;
      return {
        heapUsed:1_000_000+100*n,rss:8_000_000+50*n,
        external:500_000, arrayBuffers:200_000
      };
    }
  });
  assert.equal(report.kind,'mysql-sustained-recovery-profile');
  assert.equal(report.serverVersion,'8.4-fixture');
  assert.equal(report.cyclesCompleted,16);
  assert.equal(report.operationsCompleted,32);
  assert.equal(report.rowsValidated,960);
  assert.equal(report.resultSetsValidated,64);
  assert.equal(report.sessionContinuityVerified,true);
  assert.equal(report.elapsedMs,1);
  assert.equal(report.checkpoints.length,5);
  assert.deepEqual(report.checkpoints.map(p=>p.cycle),[0,4,8,12,16]);
  assert.equal(report.postGcTrend.heapUsed.firstToLastDeltaBytes,400);
  assert.equal(report.postGcTrend.heapUsed.earlyToLateMedianDeltaBytes,200);
  assert.equal(f.identityQueries,5,'one baseline and four session-ID checks');
  assert.equal(f.queries,34,'two warmups and 32 measured queries');
  assert.equal(f.closed,1);
  assert.equal(gcCount,5,'one baseline and four checkpoints');
  assert.ok(!JSON.stringify(report).includes('test-password'));
  assert.ok(!JSON.stringify(report).includes('SELECT'));
});

test('connection replacement fails recovery qualification and closes session',async()=>{
  const f=fixture({rotateConnection:true});
  await assert.rejects(profileRecoverySoak({
    connect:async()=>f.connection,target:{engine:'mysql'},
    options:{rows:20,rowBytes:256,cycles:16,checkpointEvery:4},
    gc:()=>{},memoryUsage:process.memoryUsage,
    now:()=>performance.now()
  }),/connection changed/);
  assert.equal(f.closed,1);
  assert.equal(f.identityQueries,3);
});

test('corrupt data, invalid connection IDs and measurements fail closed',async()=>{
  for(const [config,expected] of [
    [{badLarge:true},/Invalid live retention large multi-result row/],
    [{badIdentity:true},/Invalid MySQL recovery soak connection identity/]
  ]){
    const f=fixture(config);
    await assert.rejects(profileRecoverySoak({
      connect:async()=>f.connection,target:{engine:'mysql'},
      options:{rows:20,rowBytes:256,cycles:16,checkpointEvery:4},
      gc:()=>{},memoryUsage:process.memoryUsage
    }),expected);
    assert.equal(f.closed,1);
  }
  const f=fixture();
  await assert.rejects(profileRecoverySoak({
    connect:async()=>f.connection,target:{engine:'mysql'},
    options:{rows:20,rowBytes:256,cycles:16,checkpointEvery:4},
    gc:()=>{},memoryUsage:()=>({heapUsed:-1,rss:0,external:0,arrayBuffers:0})
  }),/memory measurement/);
  assert.equal(f.closed,1);
  await assert.rejects(profileRecoverySoak({
    connect:async()=>fixture().connection,target:{engine:'mysql'},
    gc:null
  }),/requires isolated MySQL and --expose-gc/);
});
