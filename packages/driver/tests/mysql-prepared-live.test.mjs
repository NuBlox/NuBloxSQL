import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectDatabase,createDatabasePool} from '../dist/index.js';

const live=process.env.NUBLOX_LIVE_MYSQL==='1'?test:test.skip;
const target={
  engine:'mysql',host:'127.0.0.1',port:Number(process.env.MYSQL_PORT||3306),
  user:process.env.MYSQL_USER||'root',password:process.env.MYSQL_PASSWORD||'test-password',
  database:'nublox_test',security:'isolated-local',timeoutMs:6000
};

live('one native prepared statement supports repeated bound execution, strict parameters and explicit close',async()=>{
 const db=await connectDatabase(target);
 try{
  const statement=await db.prepare('SELECT ? AS label, ? AS amount, ? AS nullable');
  assert.equal(statement.parameterCount,3);
  try{
   for(let i=0;i<5;i++){
    const value=(await statement.execute(['iteration-'+i,BigInt(i),null])).rows[0];
    assert.equal(value.label,'iteration-'+i);
    assert.equal(value.amount,BigInt(i));
    assert.equal(value.nullable,null);
   }
   await assert.rejects(statement.execute(['missing',12]),e=>e.code==='INVALID_INPUT');
   assert.equal(db.closed,false);
   assert.equal((await statement.execute(['good',13,null])).rows[0].amount,13n);
  }finally{await statement.close();}
  assert.equal(statement.closed,true);
  await statement.close();
  await assert.rejects(statement.execute(['late',9,null]),e=>e.code==='CONNECTION_CLOSED');
  assert.equal((await db.query('SELECT ? AS working',[21])).rows[0].working,21n);
 }finally{await db.close();}
});

live('prepared statement is server side and does not re-prepare on execute',async()=>{
 const db=await connectDatabase(target);
 const sql="SELECT VARIABLE_VALUE AS count FROM performance_schema.session_status WHERE VARIABLE_NAME = 'Com_stmt_prepare'";
 const count=async()=>BigInt((await db.query(sql)).rows[0].count);
 try{
  const before=await count();
  const statement=await db.prepare('SELECT ? AS repeated');
  try{
   const after=await count();
   // One explicit COM_STMT_PREPARE plus one for the count query.
   assert.equal(after,before+2n);
   for(let i=0;i<4;i++)
    assert.equal((await statement.execute([i])).rows[0].repeated,BigInt(i));
   const afterRuns=await count();
   // Only the diagnostic query was prepared; no extra prepare for execute().
   assert.equal(afterRuns,after+1n);
  }finally{await statement.close();}
 }finally{await db.close();}
});

live('prepared statement errors remain structured and recoverable',async()=>{
 const db=await connectDatabase(target);
 try{
  const statement=await db.prepare('SELECT ? AS safe_value');
  try{
   await assert.rejects(statement.execute([Infinity]),e=>e instanceof Error);
   assert.equal((await statement.execute(["x' OR 1=1 --"])).rows[0].safe_value,"x' OR 1=1 --");
   assert.equal(db.closed,false);
  }finally{await statement.close();}
 }finally{await db.close();}
});

live('prepared statement cancellation closes its connection and invalidates handle',async()=>{
 const db=await connectDatabase(target);
 const statement=await db.prepare('SELECT SLEEP(?) AS slept');
 const controller=new AbortController();
 const active=statement.execute([3],{signal:controller.signal});
 setTimeout(()=>controller.abort(),120);
 await assert.rejects(active,e=>e.code==='CANCELLED');
 assert.equal(db.closed,true);
 assert.equal(statement.closed,true);
 await assert.rejects(statement.execute([0]),e=>e.code==='CONNECTION_CLOSED');
 await statement.close();
 await db.close();
});

live('pool reset invalidates open prepared handles and resets server-side statements',async()=>{
 const pool=createDatabasePool(target,{maxConnections:1});
 let old;
 let before;
 try{
  before=await pool.withConnection(async session=>{
   const id=(await session.query('SELECT CONNECTION_ID() AS id')).rows[0].id;
   old=await session.prepare('SELECT ? AS pooled');
   assert.equal((await old.execute([71])).rows[0].pooled,71n);
   // Returning a lease automatically invokes COM_RESET_CONNECTION.
   return id;
  });
  assert.equal(old.closed,true);
  await assert.rejects(old.execute([72]),e=>e.code==='CONNECTION_CLOSED');
  const next=await pool.withConnection(async session=>{
   const fresh=await session.prepare('SELECT ? AS fresh');
   try{
    assert.equal((await fresh.execute([73])).rows[0].fresh,73n);
   }finally{await fresh.close();}
   return (await session.query('SELECT CONNECTION_ID() AS id')).rows[0].id;
  });
  assert.equal(next,before);
 }finally{await pool.close();}
});

live('prepared handles cannot escape pooled callback even when manually closed',async()=>{
 const pool=createDatabasePool(target,{maxConnections:1});
 let escaped;
 try{
  await pool.withConnection(async session=>{
   escaped=await session.prepare('SELECT ? AS guard');
   assert.equal((await escaped.execute([99])).rows[0].guard,99n);
   await escaped.close();
   assert.equal(escaped.closed,true);
  });
  await assert.rejects(escaped.execute([1]),e=>e.code==='CONNECTION_CLOSED');
  await assert.rejects(escaped.close(),e=>e.code==='CONNECTION_CLOSED');
 }finally{await pool.close();}
});

live('unawaited prepared statement execution prevents returning pooled connection',async()=>{
 const pool=createDatabasePool(target,{maxConnections:1});
 let first;
 let background;
 try{
  first=await pool.withConnection(async session=>{
   const id=(await session.query('SELECT CONNECTION_ID() AS id')).rows[0].id;
   const statement=await session.prepare('SELECT SLEEP(?) AS delayed');
   background=statement.execute([0.4]);
   return id;
  });
  await assert.rejects(background,e=>e instanceof Error);
  const next=await pool.withConnection(async session=>
    (await session.query('SELECT CONNECTION_ID() AS id')).rows[0].id);
  assert.notEqual(next,first,'pool must discard connection with unawaited work');
 }finally{await pool.close();}
});
