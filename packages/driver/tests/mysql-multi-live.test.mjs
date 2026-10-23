import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectDatabase,createDatabasePool} from '../dist/index.js';

const live=process.env.NUBLOX_LIVE_MYSQL==='1'?test:test.skip;
const target={
  engine:'mysql',host:'127.0.0.1',port:Number(process.env.MYSQL_PORT||3306),
  user:process.env.MYSQL_USER||'root',password:process.env.MYSQL_PASSWORD||'test-password',
  database:'nublox_test',security:'isolated-local',timeoutMs:15000
};
function inspectProcedureResults(results,base){
  assert.equal(results.length,3,'two SELECT result sets plus final CALL status');
  assert.deepEqual(results[0].columns.map(c=>c.name),['first_value','label']);
  assert.equal(results[0].rows[0].first_value,BigInt(base));
  assert.equal(results[0].rows[0].label,'first');
  assert.deepEqual(results[1].columns.map(c=>c.name),['second_value']);
  assert.equal(results[1].rows[0].second_value,BigInt(base+1));
  assert.deepEqual(results[2].rows,[]);
  assert.deepEqual(results[2].columns,[]);
}
live('single prepared CALL returns every ordered result and terminal OK without desynchronising socket',async()=>{
 const db=await connectDatabase(target);
 try{
  inspectProcedureResults(await db.queryResults('CALL nublox_multi_result(?)',[41]),41);
  assert.equal((await db.query('SELECT ? AS after',[50])).rows[0].after,50n);
  const simple=await db.queryResults('SELECT ? AS only_result',[7]);
  assert.equal(simple.length,1);
  assert.equal(simple[0].rows[0].only_result,7n);
  const noRows=await db.queryResults('SET @nublox_multi_status = ?',[8]);
  assert.equal(noRows.length,1);
  assert.equal(noRows[0].rows.length,0);
  assert.equal(db.closed,false);
 }finally{await db.close();}
});

live('legacy single-result query drains stored procedure then rejects without poisoning connection',async()=>{
 const db=await connectDatabase(target);
 try{
  await assert.rejects(db.query('CALL nublox_multi_result(?)',[5]),
    e=>e.code==='UNSUPPORTED_FEATURE');
  assert.equal(db.closed,false);
  assert.equal((await db.query('SELECT ? AS intact',[72])).rows[0].intact,72n);
 }finally{await db.close();}
});

live('reusable prepared CALL executes all results repeatedly and closes cleanly',async()=>{
 const db=await connectDatabase(target);
 try{
  const prepared=await db.prepare('CALL nublox_multi_result(?)');
  try{
   assert.equal(prepared.parameterCount,1);
   inspectProcedureResults(await prepared.executeResults([11]),11);
   inspectProcedureResults(await prepared.executeResults([22]),22);
   await assert.rejects(prepared.execute([33]),e=>e.code==='UNSUPPORTED_FEATURE');
   assert.equal((await db.query('SELECT ? AS intact',[1])).rows[0].intact,1n);
  }finally{await prepared.close();}
  await assert.rejects(prepared.executeResults([44]),e=>e.code==='CONNECTION_CLOSED');
 }finally{await db.close();}
});

live('stored procedure OUT parameters are distinguished without losing intermediate sets',async()=>{
 const db=await connectDatabase(target);
 try{
  const results=await db.queryResults('CALL nublox_out_result(?,?)',[5,null]);
  assert.ok(results.length>=2);
  assert.equal(results[0].rows[0].input_value,5n);
  assert.ok(results.some(r=>r.outParameters),'OUT result flag should identify output parameter set');
  assert.equal((await db.query('SELECT ? AS after_out',[60])).rows[0].after_out,60n);
 }finally{await db.close();}
});

live('multi-result count limit fails closed rather than retaining unread MySQL protocol packets',async()=>{
 const db=await connectDatabase(target);
 try{
  await assert.rejects(db.queryResults('CALL nublox_many_result()'),
    e=>e.code==='RESOURCE_LIMIT');
  assert.equal(db.closed,true,'over-limit result stream must destroy its native connection');
 }finally{await db.close();}
});

live('transactions preserve callback scope and serial ordering for multi-result calls',async()=>{
 const db=await connectDatabase(target);
 try{
  const values=await db.transaction(async tx=>{
   const first=tx.queryResults('CALL nublox_multi_result(?)',[1]);
   const second=tx.queryResults('CALL nublox_multi_result(?)',[2]);
   const third=tx.query('SELECT ? AS regular',[3]);
   const result=await Promise.all([first,second,third]);
   inspectProcedureResults(result[0],1);
   inspectProcedureResults(result[1],2);
   return result[2].rows[0].regular;
  });
  assert.equal(values,3n);
  assert.equal((await db.query('SELECT ? AS usable',[4])).rows[0].usable,4n);
 }finally{await db.close();}
});

live('pooled multi-result session remains reset, and escaped leases reject further results',async()=>{
 const pool=createDatabasePool(target,{maxConnections:1});
 let escaped,oldId;
 try{
  oldId=await pool.withConnection(async lease=>{
   escaped=lease;
   inspectProcedureResults(await lease.queryResults('CALL nublox_multi_result(?)',[17]),17);
   return (await lease.query('SELECT CONNECTION_ID() AS id')).rows[0].id;
  });
  await assert.rejects(escaped.queryResults('CALL nublox_multi_result(?)',[17]),
    e=>e.code==='CONNECTION_CLOSED');
  const nextId=await pool.withConnection(async lease=>{
   inspectProcedureResults(await lease.queryResults('CALL nublox_multi_result(?)',[18]),18);
   return (await lease.query('SELECT CONNECTION_ID() AS id')).rows[0].id;
  });
  assert.equal(oldId,nextId);
  assert.equal(pool.stats.healthFailures,0);
 }finally{await pool.close();}
});
