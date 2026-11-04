import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseWriteSoakOptions,checkWriteSoakEnvironment,
  checkVerifiedTlsWriteSoakEnvironment,runWriteSoak}
  from './write-soak.mjs';

const env={
  CI:'true',GITHUB_ACTIONS:'true',NUBLOX_LIVE_MYSQL:'1',
  NUBLOX_ALLOW_WRITE_MYSQL_FIXTURE:'1',NUBLOX_QUALIFICATION_MYSQL_VERSION:'8.4.13',
  MYSQL_DATABASE:'nublox_test',MYSQL_PORT:'3306',
  GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'12345'
};
test('only explicit pinned disposable GitHub Actions fixture is allowed',()=>{
  assert.equal(checkWriteSoakEnvironment(env),'nublox_write_soak_12345');
  for(const key of Object.keys(env)){
    assert.throws(()=>checkWriteSoakEnvironment({...env,[key]:'invalid'}),key);
  }
  assert.throws(()=>checkWriteSoakEnvironment({...env,GITHUB_RUN_ID:'1; DROP TABLE'}));
});
test('duration, capacity and transaction ceiling are hard bounded',()=>{
  assert.deepEqual(parseWriteSoakOptions([]),{
    durationMs:10000,concurrency:4,maxTransactions:100000000
  });
  for(const arg of ['--durationMs=399','--durationMs=7200001','--concurrency=1',
    '--concurrency=9','--maxTransactions=99','--maxTransactions=100000001',
    '--invalid=2','--durationMs=x'])
    assert.throws(()=>parseWriteSoakOptions([arg]));
  assert.throws(()=>parseWriteSoakOptions(['--concurrency=2','--concurrency=2']));
});
function fixture({corrupt=false,swallowRollback=false}={}){
  let time=0,created=false,dropped=false,closed=false;
  const counters=new Map();
  const query=async(sql,args=[])=>{
    time+=5;
    if(sql.startsWith('CREATE TABLE')){created=true;return {rows:[]};}
    if(sql.startsWith('DROP TABLE')){dropped=true;return {rows:[]};}
    if(sql.startsWith('INSERT INTO')){
      counters.set(args[0],args[1]);return {affectedRows:1};
    }
    if(sql.startsWith('UPDATE')){
      counters.set(args[0],counters.get(args[0])+1);
      return {affectedRows:1};
    }
    if(sql.startsWith('SELECT worker_id,counter'))
      return {rows:[...counters].sort((a,b)=>a[0]-b[0]).map(
        ([worker_id,counter])=>({worker_id:BigInt(worker_id),counter:BigInt(counter)})
      )};
    if(sql.startsWith('SELECT counter'))
      return {rows:[{counter:BigInt(counters.get(args[0])+(corrupt?1:0))}]};
    throw Error('Unexpected SQL');
  };
  let mutex=Promise.resolve();
  const lease={
    query,
    transaction:async fn=>{
      let release;
      const previous=mutex;
      mutex=new Promise(resolve=>{release=resolve;});
      await previous;
      const snapshot=new Map(counters);
      try{return await fn({query});}
      catch(error){
        if(!swallowRollback){
          counters.clear();
          for(const [key,value] of snapshot)counters.set(key,value);
          throw error;
        }
      }finally{release();}
    }
  };
  const pool={
    get stats(){return {size:closed?0:2,idle:closed?0:2,
      pending:0,active:0,connecting:0};},
    withConnection:fn=>fn(lease),
    close:async()=>{closed=true;}
  };
  return {
    connect:async()=>({info:{version:'8.4.13'},query,close:async()=>{}}),
    createPool:()=>pool,now:()=>time,
    memoryUsage:()=>({heapUsed:20000000,rss:90000000,external:1000000,arrayBuffers:100000}),
    get state(){return {created,dropped,closed};}
  };
}
const options=parseWriteSoakOptions(['--durationMs=400','--concurrency=2',
  '--maxTransactions=1000']);
test('mixed committed writes and deliberate rollback preserve durable state',async()=>{
  const f=fixture();
  const result=await runWriteSoak({...f,target:{engine:'mysql'},
    administratorTarget:{engine:'mysql',role:'administrator'},
    table:'nublox_write_soak_12345',options});
  assert.ok(result.observedDurationMs>=400);
  assert.ok(result.committedTransactions>=2);
  assert.ok(result.rolledBackTransactions>=2);
  assert.equal(result.committedTransactions,result.finalCounterSum);
  assert.equal(result.verifiedReads,result.completedTransactions);
  assert.equal(result.resources.poolAfterClose.size,0);
  assert.equal(result.resources.progressEvidence.completed,result.completedTransactions);
  assert.equal(result.resources.progressTimeline.progress.endCompleted,
    result.completedTransactions);
  assert.equal(result.tableDropped,true);
  assert.equal(f.state.dropped,true);
});
test('unexpected counter or silently swallowed rollback is fatal and cleaned up',async()=>{
  for(const variant of [{corrupt:true},{swallowRollback:true}]){
    const f=fixture(variant);
    await assert.rejects(runWriteSoak({...f,target:{engine:'mysql'},
      table:'nublox_write_soak_12345',options}));
    assert.equal(f.state.dropped,true);
    assert.equal(f.state.closed,true);
  }
});

test('verified TLS write fixture requires pinned server, CI and restricted identity',()=>{
  const secure={...env,NUBLOX_LIVE_MYSQL_TLS:'1',NUBLOX_TEST_MYSQL_VERSION:'8.4.13',
    MYSQL_TLS_PORT:'3307',MYSQL_USER:'root',MYSQL_WRITE_USER:'nublox_write_test',
    MYSQL_WRITE_PASSWORD:'test-write-password',
    NUBLOX_TLS_CA_FILE:'/tmp/ca.pem',
    NUBLOX_TLS_OTHER_CA_FILE:'/tmp/unrelated-ca.pem'};
  assert.equal(checkVerifiedTlsWriteSoakEnvironment(secure),'nublox_write_soak_12345');
  for(const key of ['CI','GITHUB_ACTIONS','NUBLOX_LIVE_MYSQL_TLS',
    'NUBLOX_ALLOW_WRITE_MYSQL_FIXTURE','NUBLOX_TEST_MYSQL_VERSION',
    'NUBLOX_QUALIFICATION_MYSQL_VERSION','MYSQL_DATABASE','MYSQL_TLS_PORT',
    'MYSQL_USER','MYSQL_WRITE_USER','MYSQL_WRITE_PASSWORD',
    'NUBLOX_TLS_CA_FILE','NUBLOX_TLS_OTHER_CA_FILE','GITHUB_RUN_ID','GITHUB_SHA']){
    const invalid=key==='MYSQL_WRITE_PASSWORD'||key.endsWith('_CA_FILE')?'':'wrong';
    assert.throws(()=>checkVerifiedTlsWriteSoakEnvironment({...secure,[key]:invalid}),
      'Rejected '+key);
  }
});
