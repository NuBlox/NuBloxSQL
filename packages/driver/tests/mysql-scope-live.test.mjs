import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectDatabase,createDatabasePool} from '../dist/index.js';

const live=process.env.NUBLOX_LIVE_MYSQL==='1'?test:test.skip;
const target={
  engine:'mysql',host:'127.0.0.1',port:Number(process.env.MYSQL_PORT||3306),
  user:process.env.MYSQL_USER||'root',password:process.env.MYSQL_PASSWORD||'test-password',
  database:'nublox_test',security:'isolated-local',timeoutMs:5000
};

live('parent-session calls inside transaction reject instead of deadlocking and roll back',async()=>{
 const db=await connectDatabase(target);
 try{
  await db.query('CREATE TEMPORARY TABLE nublox_scope_tx (id INT PRIMARY KEY)');
  await assert.rejects(db.transaction(async tx=>{
   await tx.query('INSERT INTO nublox_scope_tx VALUES (?)',[31]);
   await db.query('SELECT 1');
  }),e=>e.code==='INVALID_INPUT'&&/transaction/.test(e.message));
  const after=(await db.query('SELECT COUNT(*) AS n FROM nublox_scope_tx')).rows[0].n;
  assert.equal(after,0n,'nested call failure must trigger transaction rollback');
  await assert.rejects(db.transaction(async()=>{
   await db.transaction(async tx=>tx.query('SELECT 1'));
  }),e=>e.code==='INVALID_INPUT');
  assert.equal((await db.query('SELECT ? AS alive',[51])).rows[0].alive,51n);
 }finally{await db.close();}
});

live('transaction may catch a nested error and continue using tx.query',async()=>{
 const db=await connectDatabase(target);
 try{
  const value=await db.transaction(async tx=>{
   await assert.rejects(db.prepare('SELECT 1'),e=>e.code==='INVALID_INPUT');
   await assert.rejects(db.withCursor('SELECT 1',[],async()=>{}),e=>e.code==='INVALID_INPUT');
   assert.equal((await tx.query('SELECT ? AS answer',[42])).rows[0].answer,42n);
   return 'committed';
  });
  assert.equal(value,'committed');
  assert.equal(db.closed,false);
 }finally{await db.close();}
});

live('concurrent transaction-scoped commands serialize safely on one socket',async()=>{
 const db=await connectDatabase(target);
 try{
  const values=await db.transaction(async tx=>{
   const operations=Array.from({length:24},(_,i)=>tx.query('SELECT ? AS ordinal',[i]));
   const results=await Promise.all(operations);
   return results.map(r=>r.rows[0].ordinal);
  });
  assert.deepEqual(values,Array.from({length:24},(_,i)=>BigInt(i)));
  assert.equal((await db.query('SELECT ? AS still_healthy',[84])).rows[0].still_healthy,84n);
 }finally{await db.close();}
});

live('independent callers still queue while an exclusive transaction is active',async()=>{
 const db=await connectDatabase(target);
 let release;
 let entered;
 const gate=new Promise(resolve=>{release=resolve;});
 const started=new Promise(resolve=>{entered=resolve;});
 try{
  const active=db.transaction(async tx=>{
   await tx.query('SELECT ? AS inside',[12]);
   entered();
   await gate;
   assert.equal((await tx.query('SELECT ? AS continued',[13])).rows[0].continued,13n);
  });
  await started;
  let outsideFinished=false;
  const outside=db.query('SELECT ? AS outside',[77]).then(value=>{
   outsideFinished=true;
   return value;
  });
  await new Promise(resolve=>setTimeout(resolve,35));
  assert.equal(outsideFinished,false,'unrelated session operation must await the active transaction');
  release();
  await active;
  assert.equal((await outside).rows[0].outside,77n);
  assert.equal(db.closed,false);
 }finally{
  release?.();
  await db.close();
 }
});

live('a transaction handle cannot be used from unrelated context or after callback returns',async()=>{
 const db=await connectDatabase(target);
 let escaped,release,entered;
 const gate=new Promise(resolve=>{release=resolve;});
 const started=new Promise(resolve=>{entered=resolve;});
 try{
  const txWork=db.transaction(async tx=>{
   escaped=tx;
   entered();
   await gate;
   assert.equal((await tx.query('SELECT ? AS valid',[54])).rows[0].valid,54n);
  });
  await started;
  await assert.rejects(escaped.query('SELECT 1'),e=>e.code==='CONNECTION_CLOSED');
  release();
  await txWork;
  await assert.rejects(escaped.query('SELECT 2'),e=>e.code==='CONNECTION_CLOSED');
  assert.equal((await db.query('SELECT 3 AS yes')).rows[0].yes,3n);
 }finally{release?.();await db.close();}
});

live('nested statement.close rejection does not leak or invalidate the reusable statement',async()=>{
 const db=await connectDatabase(target);
 const stmt=await db.prepare('SELECT ? AS exact');
 try{
  await db.transaction(async tx=>{
   await assert.rejects(stmt.close(),e=>e.code==='INVALID_INPUT');
   assert.equal(stmt.closed,false);
   await assert.rejects(stmt.execute([12]),e=>e.code==='INVALID_INPUT');
   assert.equal((await tx.query('SELECT 1 AS ok')).rows[0].ok,1n);
  });
  assert.equal((await stmt.execute([18])).rows[0].exact,18n);
  await stmt.close();
  assert.equal(stmt.closed,true);
  assert.equal(db.closed,false);
 }finally{await stmt.close();await db.close();}
});

live('cursor callback rejects nested parent-session work but continues fetching',async()=>{
 const db=await connectDatabase(target);
 try{
  const result=await db.withCursor('SELECT ? AS value UNION ALL SELECT ?',[31,32],async cursor=>{
   await assert.rejects(db.query('SELECT ? AS nested',[100]),e=>e.code==='INVALID_INPUT'&&/cursor/.test(e.message));
   await assert.rejects(db.transaction(async tx=>tx.query('SELECT 1')),e=>e.code==='INVALID_INPUT');
   await assert.rejects(db.prepare('SELECT 1'),e=>e.code==='INVALID_INPUT');
   await assert.rejects(db.withCursor('SELECT 1',[],async()=>{}),e=>e.code==='INVALID_INPUT');
   const rows=[];
   for await(const {row} of cursor)rows.push(row.value);
   return rows;
  },{fetchSize:1});
  assert.deepEqual(result,[31n,32n]);
  assert.equal((await db.query('SELECT ? AS recovered',[93])).rows[0].recovered,93n);
 }finally{await db.close();}
});

live('pool nested checkout fails immediately even with one connection, while independent borrowers queue',async()=>{
 const pool=createDatabasePool(target,{maxConnections:1,acquireTimeoutMs:1000});
 let release,entered;
 const gate=new Promise(resolve=>{release=resolve;});
 const started=new Promise(resolve=>{entered=resolve;});
 try{
  const active=pool.withConnection(async lease=>{
   await assert.rejects(pool.withConnection(async()=> 'should-not-run'),e=>e.code==='INVALID_INPUT');
   assert.equal((await lease.query('SELECT ? AS leased',[9])).rows[0].leased,9n);
   entered();
   await gate;
  });
  await started;
  const independent=pool.withConnection(async lease=>(await lease.query('SELECT ? AS queued',[10])).rows[0].queued);
  assert.equal(pool.stats.pending,1);
  release();
  await active;
  assert.equal(await independent,10n);
  assert.equal(pool.stats.created,1);
  assert.equal(pool.stats.healthFailures,0);
 }finally{release?.();await pool.close();}
});

live('detached tasks do not inherit a permanently active exclusive scope',async()=>{
 const db=await connectDatabase(target);
 let late;
 try{
  await db.transaction(async tx=>{
   assert.equal((await tx.query('SELECT 1 AS inside')).rows[0].inside,1n);
   late=new Promise((resolve,reject)=>setTimeout(()=>{
    db.query('SELECT ? AS later',[77]).then(resolve,reject);
   },25));
  });
  assert.equal((await late).rows[0].later,77n);
  assert.equal(db.closed,false);
 }finally{await db.close();}
});

live('per-session command queue rejects overload without destroying an active transaction',async()=>{
 const db=await connectDatabase(target);
 let release,entered;
 const gate=new Promise(resolve=>{release=resolve;});
 const started=new Promise(resolve=>{entered=resolve;});
 const controller=new AbortController();
 try{
  const active=db.transaction(async tx=>{
   entered();
   await gate;
   assert.equal((await tx.query('SELECT 1 AS healthy')).rows[0].healthy,1n);
  });
  await started;
  const queued=Array.from({length:1024},()=>db.query('SELECT 1',[],{signal:controller.signal}));
  const settled=Promise.allSettled(queued);
  await assert.rejects(db.query('SELECT 2'),e=>e.code==='RESOURCE_LIMIT');
  controller.abort();
  const results=await settled;
  assert.ok(results.every(x=>x.status==='rejected'&&x.reason.code==='CANCELLED'));
  release();
  await active;
  assert.equal((await db.query('SELECT 3 AS usable')).rows[0].usable,3n);
  assert.equal(db.closed,false);
 }finally{
  controller.abort();
  release?.();
  await db.close();
 }
});

live('transaction queue bounds 1024 waiting commands without sending or replaying SQL',{timeout:10000},async()=>{
 const db=await connectDatabase(target);
 const original=db.execute.bind(db);
 let releaseFirst,enteredFirst;
 const firstStarted=new Promise(resolve=>{enteredFirst=resolve;});
 const gate=new Promise(resolve=>{releaseFirst=resolve;});
 let executed=0;
 // Deterministic test-only fault injection holds the first scoped command.
 // Transaction START/COMMIT still use the real MySQL Classic connection.
 db.execute=async()=>{
  executed++;
  if(executed===1){
   enteredFirst();
   await gate;
  }
  return {rows:[],columns:[],affectedRows:0,insertId:0};
 };
 try{
  const committed=await db.transaction(async tx=>{
   const queued=Array.from({length:1024},()=>tx.query('SELECT 1'));
   const completion=Promise.all(queued);
   await firstStarted;
   await assert.rejects(tx.query('SELECT 2'),error=>
     error.code==='RESOURCE_LIMIT'&&/transaction/.test(error.message));
   assert.equal(executed,1,'overflow must not reach the native command executor');
   releaseFirst();
   await completion;
   assert.equal(executed,1024,'exactly the accepted commands must run once');
   return 'committed';
  });
  assert.equal(committed,'committed');
  assert.equal(db.closed,false);
  assert.equal((await db.query('SELECT ? AS recovered',[61])).rows[0].recovered,61n);
 }finally{
  releaseFirst?.();
  db.execute=original;
  await db.close();
 }
});

live('transaction backlog is rejected after disconnect and cannot execute late SQL',{timeout:10000},async()=>{
 const db=await connectDatabase(target);
 const original=db.execute.bind(db);
 let releaseFirst,enteredFirst;
 const firstStarted=new Promise(resolve=>{enteredFirst=resolve;});
 const gate=new Promise(resolve=>{releaseFirst=resolve;});
 let executed=0;
 db.execute=async(...args)=>{
  executed++;
  if(executed===1){
   enteredFirst();
   await gate;
  }
  return original(...args);
 };
 try{
  const transaction=db.transaction(async tx=>{
   const pending=Array.from({length:256},()=>tx.query('SELECT 1'));
   const settled=Promise.allSettled(pending);
   await firstStarted;
   // Closing the native session must invalidate the transaction scope
   // before any of the queued commands can be transmitted.
   await db.close();
   releaseFirst();
   const results=await settled;
   assert.ok(results.every(r=>r.status==='rejected'&&r.reason.code==='CONNECTION_CLOSED'));
  });
  await assert.rejects(transaction,error=>error.code==='CONNECTION_CLOSED');
  assert.equal(db.closed,true);
  assert.equal(executed,1,'no queued transaction query may execute after disconnect');
 }finally{
  releaseFirst?.();
  db.execute=original;
  await db.close();
 }
});
