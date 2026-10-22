import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDatabasePool} from '../dist/index.js';

const live=process.env.NUBLOX_LIVE_MYSQL==='1'?test:test.skip;
const target={
  engine:'mysql',host:'127.0.0.1',port:Number(process.env.MYSQL_PORT||3306),
  user:process.env.MYSQL_USER||'root',password:process.env.MYSQL_PASSWORD||'test-password',
  database:'nublox_test',security:'isolated-local',timeoutMs:3000
};
const idOf=async session=>(await session.query('SELECT CONNECTION_ID() AS id')).rows[0].id;

live('pool reuses a single native connection only after SQL state reset',async()=>{
 const pool=createDatabasePool(target,{maxConnections:1});
 let firstId;
 try{
  firstId=await pool.withConnection(async session=>{
   const id=await idOf(session);
   await session.query('SET @nublox_pool_user_value = 617');
   await session.query('CREATE TEMPORARY TABLE nublox_pool_temporary (id INT)');
   await session.query('INSERT INTO nublox_pool_temporary (id) VALUES (?)',[42]);
   return id;
  });
  const secondId=await pool.withConnection(async session=>{
   const id=await idOf(session);
   assert.equal((await session.query('SELECT @nublox_pool_user_value AS old_value')).rows[0].old_value,null);
   await assert.rejects(
     session.query('SELECT * FROM nublox_pool_temporary'),
     error=>error.code==='DATABASE_ERROR'
   );
   assert.equal((await session.query('SELECT ? AS still_usable',[19])).rows[0].still_usable,19n);
   return id;
  });
  assert.equal(secondId,firstId,'pool should reuse the same authenticated server connection');
  assert.equal(pool.stats.size,1);
  assert.equal(pool.stats.idle,1);
 }finally{await pool.close();}
 assert.equal(pool.closed,true);
 assert.equal(pool.stats.size,0);
});

live('pool reset rolls back a manually started uncommitted transaction',async()=>{
 const pool=createDatabasePool(target,{maxConnections:1});
 try{
  await pool.withConnection(async session=>{
   await session.query('CREATE TABLE IF NOT EXISTS nublox_pool_rollback (id INT PRIMARY KEY)');
   await session.query('DELETE FROM nublox_pool_rollback');
  });
  try{
   await pool.withConnection(async session=>{
    await session.query('SET autocommit = 0');
    await session.query('INSERT INTO nublox_pool_rollback (id) VALUES (?)',[771]);
   });
   const count=await pool.withConnection(async session=>
    (await session.query('SELECT COUNT(*) AS n FROM nublox_pool_rollback')).rows[0].n
   );
   assert.equal(count,0n,'reset must roll back an open transaction');
   const autocommit=await pool.withConnection(async session=>(await session.query('SELECT @@autocommit AS mode')).rows[0].mode);
   assert.equal(autocommit,1n,'reset must restore autocommit');
  }finally{
   await pool.withConnection(session=>session.query('DROP TABLE IF EXISTS nublox_pool_rollback'));
  }
 }finally{await pool.close();}
});

live('pool enforces max connections and times out only queued acquisitions',async()=>{
 const pool=createDatabasePool(target,{maxConnections:1,acquireTimeoutMs:150});
 let unblock;
 const gate=new Promise(resolve=>{unblock=resolve;});
 const held=pool.withConnection(async session=>{
  assert.equal((await session.query('SELECT 1 AS ready')).rows[0].ready,1n);
  await gate;
 });
 try{
  // Ensures the first lease has reached its callback before timing the second.
  while(pool.stats.size===0)await new Promise(r=>setTimeout(r,5));
  await assert.rejects(pool.withConnection(async()=>42),e=>e.code==='TIMEOUT');
  assert.equal(pool.stats.size,1);
  assert.equal(pool.stats.pending,0);
 }finally{
  unblock();
  await held;
  await pool.close();
 }
});

live('connection failures and interrupted commands cannot poison pooled reuse',async()=>{
 const pool=createDatabasePool(target,{maxConnections:1});
 let interruptedId;
 try{
  interruptedId=await pool.withConnection(async session=>{
   const id=await idOf(session);
   await assert.rejects(
    session.query('SELECT SLEEP(3)',[],{timeoutMs:140}),e=>e.code==='TIMEOUT'
   );
   assert.equal(session.closed,true);
   return id;
  });
  assert.equal(pool.stats.size,0);
  const fresh=await pool.withConnection(async session=>{
   assert.equal((await session.query('SELECT ? AS ok',[78])).rows[0].ok,78n);
   return idOf(session);
  });
  assert.notEqual(fresh,interruptedId);
 }finally{await pool.close();}
});

live('escaped leases reject late operations and failed callbacks discard sessions',async()=>{
 const pool=createDatabasePool(target,{maxConnections:1});
 let escaped;
 let id;
 try{
  id=await pool.withConnection(async session=>{
   escaped=session;
   return idOf(session);
  });
  await assert.rejects(escaped.query('SELECT 1'),e=>e.code==='CONNECTION_CLOSED');
  await assert.rejects(pool.withConnection(async session=>{
   assert.equal(await idOf(session),id);
   throw Error('application failure');
  }),/application failure/);
  assert.equal(pool.stats.size,0);
 }finally{await pool.close();}
});

live('closing a pool rejects waiting callers and closes active native sessions',async()=>{
 const pool=createDatabasePool(target,{maxConnections:1,acquireTimeoutMs:5000});
 let entered;
 const enteredPromise=new Promise(resolve=>{entered=resolve;});
 let unblock;
 const gate=new Promise(resolve=>{unblock=resolve;});
 const held=pool.withConnection(async session=>{
  entered();
  await gate;
  assert.equal(session.closed,true);
 });
 try{
  await enteredPromise;
  const queued=pool.withConnection(async()=>1);
  assert.equal(pool.stats.pending,1);
  await pool.close();
  await assert.rejects(queued,e=>e.code==='CONNECTION_CLOSED');
  await assert.rejects(pool.withConnection(async()=>1),e=>e.code==='CONNECTION_CLOSED');
 }finally{
  unblock();
  await held;
  await pool.close();
 }
 assert.equal(pool.stats.size,0);
});


live('completed transaction scope cannot issue commands after pool reuse',async()=>{
 const pool=createDatabasePool(target,{maxConnections:1});
 let escapedTransaction;
 try{
  const original=await pool.withConnection(async lease=>{
   await lease.transaction(async tx=>{
    escapedTransaction=tx;
    await tx.query('SELECT ? AS inside',[55]);
   });
   return idOf(lease);
  });
  await assert.rejects(
   escapedTransaction.query('SELECT 1'),e=>e.code==='CONNECTION_CLOSED'
  );
  const again=await pool.withConnection(async lease=>{
   assert.equal((await lease.query('SELECT ? AS value',[56])).rows[0].value,56n);
   return idOf(lease);
  });
  assert.equal(again,original,'late transaction queries must not invalidate healthy reused connections');
 }finally{await pool.close();}
});


live('native COM_PING verifies a reused MySQL session before every borrow',async()=>{
 const pool=createDatabasePool(target,{maxConnections:1,healthCheckTimeoutMs:1200});
 try{
  const id1=await pool.withConnection(async session=>
    (await session.query('SELECT CONNECTION_ID() AS id')).rows[0].id);
  const id2=await pool.withConnection(async session=>
    (await session.query('SELECT CONNECTION_ID() AS id')).rows[0].id);
  assert.equal(id1,id2);
  assert.equal(pool.stats.created,1);
  assert.equal(pool.stats.healthChecks,2);
  assert.equal(pool.stats.healthFailures,0);
  assert.equal(pool.stats.idle,1);
  assert.equal(pool.stats.active,0);
 }finally{await pool.close();}
});

live('idle expiry retires native connection and next borrow opens a fresh one',async()=>{
 const pool=createDatabasePool(target,{maxConnections:1,idleTimeoutMs:120});
 try{
  const id1=await pool.withConnection(async session=>
    (await session.query('SELECT CONNECTION_ID() AS id')).rows[0].id);
  const deadline=Date.now()+4000;
  while(pool.stats.expired===0&&Date.now()<deadline)
    await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(pool.stats.expired,1,'idle session must be retired promptly');
  assert.equal(pool.stats.size,0);
  assert.equal(pool.stats.idle,0);
  const id2=await pool.withConnection(async session=>
    (await session.query('SELECT CONNECTION_ID() AS id')).rows[0].id);
  assert.notEqual(id1,id2);
  assert.equal(pool.stats.created,2);
  assert.equal(pool.stats.healthFailures,0);
 }finally{await pool.close();}
});

live('pool rejects unsafe lifecycle options before opening sockets',async()=>{
 for(const options of [
  {maxConnections:0},{maxConnections:33},
  {maxConnections:1,idleTimeoutMs:99},
  {maxConnections:1,idleTimeoutMs:3600001},
  {maxConnections:1,healthCheckTimeoutMs:0}
 ]){
  assert.throws(()=>createDatabasePool(target,options),e=>e.code==='INVALID_INPUT');
 }
});
