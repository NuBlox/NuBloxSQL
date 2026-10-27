import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectDatabase,createDatabasePool} from '../dist/index.js';
import {startMysqlFaultProxy} from './fixtures/mysql-fault-proxy.mjs';

const live=process.env.NUBLOX_LIVE_MYSQL==='1'?test:test.skip;
const base={
  engine:'mysql',host:'127.0.0.1',port:Number(process.env.MYSQL_PORT||3306),
  user:process.env.MYSQL_USER||'root',password:process.env.MYSQL_PASSWORD||'test-password',
  database:'nublox_test',security:'isolated-local',timeoutMs:6000
};
async function runWithProxy(work){
  const proxy=await startMysqlFaultProxy(base.port);
  try{return await work(proxy,{...base,port:proxy.port});}
  finally{await proxy.close();}
}

live('corrupted MySQL response sequence returns PROTOCOL_ERROR and revokes prepared handle',async()=>{
 await runWithProxy(async(proxy,target)=>{
  const db=await connectDatabase(target);
  const statement=await db.prepare('SELECT ? AS fault_value');
  try{
   proxy.arm('wrong-sequence');
   await assert.rejects(statement.execute([41]),error=>error.code==='PROTOCOL_ERROR');
   assert.equal(proxy.injected,1);
   assert.equal(db.closed,true);
   assert.equal(statement.closed,true);
   await assert.rejects(db.query('SELECT 1'),error=>error.code==='CONNECTION_CLOSED');
  }finally{await db.close();}
 });
});

live('partial server packet header fails closed, and no SQL is replayed',async()=>{
 await runWithProxy(async(proxy,target)=>{
  const db=await connectDatabase(target);
  try{
   proxy.arm('truncate-header');
   await assert.rejects(db.query('SELECT ? AS broken',[21]),
     error=>error.code==='CONNECTION_CLOSED');
   assert.equal(db.closed,true);
   assert.equal(proxy.injected,1);
  }finally{await db.close();}
 });
});

live('mid-payload server reply is never interpreted as a successful query',async()=>{
 await runWithProxy(async(proxy,target)=>{
  const db=await connectDatabase(target);
  try{
   proxy.arm('truncate-body');
   await assert.rejects(db.query('SELECT ? AS broken',[22]),
     error=>error.code==='CONNECTION_CLOSED');
   assert.equal(db.closed,true);
   assert.equal(proxy.injected,1);
  }finally{await db.close();}
 });
});

live('corrupt length header cannot return partial rows or retain an unsafe socket',async()=>{
 await runWithProxy(async(proxy,target)=>{
  const db=await connectDatabase(target);
  try{
   proxy.arm('oversized-frame');
   await assert.rejects(db.query('SELECT ? AS broken',[23]),
     error=>error.code==='CONNECTION_CLOSED'||error.code==='PROTOCOL_ERROR');
   assert.equal(db.closed,true);
   assert.equal(proxy.injected,1);
  }finally{await db.close();}
 });
});

live('interrupted 17 MB parameter upload closes connection and never retries the write',async()=>{
 await runWithProxy(async(proxy,target)=>{
  const db=await connectDatabase({...target,timeoutMs:20000});
  const statement=await db.prepare('SELECT OCTET_LENGTH(?) AS received');
  try{
   proxy.arm('drop-upload');
   await assert.rejects(statement.execute([Buffer.alloc(17_000_000,0x66)]),
     error=>error.code==='CONNECTION_CLOSED');
   assert.equal(proxy.injected,1,'only one command should have been interrupted');
   assert.equal(db.closed,true);
   assert.equal(statement.closed,true);
  }finally{await db.close();}
 });
});

live('24 concurrent pooled borrowers recover after one injected protocol failure without replay',async()=>{
 await runWithProxy(async(proxy,target)=>{
  const pool=createDatabasePool(target,{
   maxConnections:1,acquireTimeoutMs:12000,healthCheckTimeoutMs:1500
  });
  try{
   const jobs=Array.from({length:24},(_,i)=>pool.withConnection(async lease=>{
    if(i===0)proxy.arm('wrong-sequence');
    return (await lease.query('SELECT ? AS ordinal',[i])).rows[0].ordinal;
   }));
   const results=await Promise.allSettled(jobs);
   assert.equal(results[0].status,'rejected');
   assert.equal(results[0].reason.code,'PROTOCOL_ERROR');
   assert.deepEqual(results.slice(1).map(r=>r.status),Array(23).fill('fulfilled'));
   assert.deepEqual(results.slice(1).map(r=>r.value),Array.from({length:23},(_,i)=>BigInt(i+1)));
   assert.equal(proxy.injected,1);
   assert.ok(pool.stats.created>=2,'fresh native socket must replace corrupted session');
   assert.ok(pool.stats.discarded>=1);
   assert.equal(pool.stats.pending,0);
   assert.ok(pool.stats.size<=1);
  }finally{await pool.close();}
 });
});

live('corrupt prepared response rejects execution but completes queued statement close',async()=>{
 await runWithProxy(async(proxy,target)=>{
  const db=await connectDatabase(target);
  const statement=await db.prepare('SELECT ? AS interrupted');
  try{
   proxy.arm('wrong-sequence');
   const active=statement.execute([52]);
   void active.catch(()=>{});
   const closing=statement.close();
   await assert.rejects(active,error=>error.code==='PROTOCOL_ERROR');
   await closing;
   assert.equal(proxy.injected,1);
   assert.equal(statement.closed,true);
   assert.equal(db.closed,true);
   await assert.rejects(statement.execute([53]),error=>error.code==='CONNECTION_CLOSED');
   const healthy=await connectDatabase(target);
   try{
    assert.equal((await healthy.query('SELECT ? AS fresh',[54])).rows[0].fresh,54n);
   }finally{await healthy.close();}
  }finally{await db.close();}
 });
});

live('lost ROLLBACK acknowledgement cannot trigger a second rollback or a false success',async()=>{
 await runWithProxy(async(proxy,target)=>{
  const db=await connectDatabase(target);
  const wire=db.stream;
  const originalSend=wire.send.bind(wire);
  let rollbackCommands=0;
  wire.send=async body=>{
    if(body[0]===0x03&&body.subarray(1).toString('ascii')==='ROLLBACK')
      rollbackCommands++;
    return originalSend(body);
  };
  try{
   await db.query('CREATE TEMPORARY TABLE nublox_rollback_fault (id INT PRIMARY KEY) ENGINE=InnoDB');
   await assert.rejects(db.transaction(async tx=>{
     await tx.query('INSERT INTO nublox_rollback_fault (id) VALUES (?)',[83]);
     // Only the subsequent ROLLBACK reply is corrupted; the INSERT was
     // acknowledged and must not be replayed on a replacement socket.
     proxy.arm('truncate-header');
     throw Error('trigger rollback');
   }),error=>error.code==='TRANSACTION_OUTCOME_UNKNOWN'&&
     /ROLLBACK acknowledgement/.test(error.message));
   assert.equal(proxy.injected,1);
   assert.equal(rollbackCommands,1,'never retry an unacknowledged rollback');
   assert.equal(db.closed,true);
   await assert.rejects(db.query('SELECT 1'),error=>error.code==='CONNECTION_CLOSED');
   const healthy=await connectDatabase(target);
   try{
     assert.equal((await healthy.query('SELECT ? AS recovered',[84])).rows[0].recovered,84n);
   }finally{await healthy.close();}
  }finally{await db.close();}
 });
});

live('truncated COMMIT OK with a valid frame and sequence cannot claim success',async()=>{
 await runWithProxy(async(proxy,target)=>{
  const db=await connectDatabase(target);
  try{
   await assert.rejects(db.transaction(async tx=>{
    assert.equal((await tx.query('SELECT ? AS before_commit',[63])).rows[0].before_commit,63n);
    proxy.arm('short-ok');
    return 'must-not-be-confirmed';
   }),error=>error.code==='TRANSACTION_OUTCOME_UNKNOWN');
   assert.equal(proxy.injected,1);
   assert.equal(db.closed,true);
   await assert.rejects(db.query('SELECT 1'),error=>error.code==='CONNECTION_CLOSED');
  }finally{await db.close();}
 });
});

live('truncated ROLLBACK OK never certifies rollback or permits socket reuse',async()=>{
 await runWithProxy(async(proxy,target)=>{
  const db=await connectDatabase(target);
  const wire=db.stream,originalSend=wire.send.bind(wire);
  let rollbacks=0;
  wire.send=async body=>{
   if(body[0]===3&&body.subarray(1).toString('ascii')==='ROLLBACK')rollbacks++;
   return originalSend(body);
  };
  try{
   await assert.rejects(db.transaction(async tx=>{
    assert.equal((await tx.query('SELECT ? AS before_rollback',[64])).rows[0].before_rollback,64n);
    proxy.arm('short-ok');
    throw Error('application requested rollback');
   }),error=>error.code==='TRANSACTION_OUTCOME_UNKNOWN');
   assert.equal(proxy.injected,1);
   assert.equal(rollbacks,1,'unconfirmed rollback cannot be resent');
   assert.equal(db.closed,true);
  }finally{await db.close();}
 });
});

live('incomplete COM_PING acknowledgement poisons the authenticated session',async()=>{
 await runWithProxy(async(proxy,target)=>{
  const db=await connectDatabase(target);
  try{
   proxy.arm('short-ok');
   await assert.rejects(db.healthCheckForPool(3000),
     error=>error.code==='PROTOCOL_ERROR');
   assert.equal(proxy.injected,1);
   assert.equal(db.closed,true);
   await assert.rejects(db.query('SELECT 1'),error=>error.code==='CONNECTION_CLOSED');
  }finally{await db.close();}
 });
});

live('incomplete COM_RESET_CONNECTION acknowledgement cannot return a session to pool',async()=>{
 await runWithProxy(async(proxy,target)=>{
  const db=await connectDatabase(target);
  try{
   proxy.arm('short-ok');
   await assert.rejects(db.resetForPool(),
     error=>error.code==='PROTOCOL_ERROR');
   assert.equal(proxy.injected,1);
   assert.equal(db.closed,true);
   await assert.rejects(db.query('SELECT 1'),error=>error.code==='CONNECTION_CLOSED');
  }finally{await db.close();}
 });
});
