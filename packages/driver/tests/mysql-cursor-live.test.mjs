import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectDatabase,createDatabasePool} from '../dist/index.js';

const live=process.env.NUBLOX_LIVE_MYSQL==='1'?test:test.skip;
const target={
  engine:'mysql',host:'127.0.0.1',port:Number(process.env.MYSQL_PORT||3306),
  user:process.env.MYSQL_USER||'root',password:process.env.MYSQL_PASSWORD||'test-password',
  database:'nublox_test',security:'isolated-local',timeoutMs:30000
};

live('native MySQL cursor fetches more than materialized row limit with bounded batches',async()=>{
 const db=await connectDatabase(target);
 try{
  await db.query('CREATE TEMPORARY TABLE nublox_cursor_values (value INT PRIMARY KEY)');
  for(let start=0;start<11000;start+=500){
    // Generate rows on the server instead of binding 11,000 parameters.
    await db.query(`INSERT INTO nublox_cursor_values (value)
      SELECT a.n+10*b.n+100*c.n+1000*d.n+?
      FROM (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) a
      JOIN (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) b
      JOIN (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4) c
      JOIN (SELECT 0 n) d`,[start]);
  }
  const count=await db.withCursor('SELECT value FROM nublox_cursor_values ORDER BY value',[],async cursor=>{
    let count=0;
    for await(const {row,values} of cursor){
      assert.equal(row.value,count);
      assert.equal(values[0],count);
      count++;
    }
    assert.equal(cursor.closed,true);
    return count;
  },{fetchSize:37,timeoutMs:30000});
  assert.equal(count,11000);
  assert.equal(db.closed,false);
  assert.equal((await db.query('SELECT ? AS still_usable',[23])).rows[0].still_usable,23n);
 }finally{await db.close();}
});

live('native cursor returns duplicate columns and exact binary values',async()=>{
 const db=await connectDatabase(target);
 let escaped;
 try{
  const values=await db.withCursor('SELECT ? AS a, ? AS a, ? AS binary_value',
    [3,4,Buffer.from([0,255])],async cursor=>{
      escaped=cursor;
      assert.deepEqual(cursor.columnKeys,['a','a#2','binary_value']);
      const collected=[];
      for await(const item of cursor)collected.push(item);
      return collected;
    },{fetchSize:1});
  assert.equal(values.length,1);
  assert.deepEqual(values[0].values,[3n,4n,Buffer.from([0,255])]);
  assert.equal(values[0].row.a,3n);
  assert.equal(values[0].row['a#2'],4n);
  assert.equal(escaped.closed,true);
  assert.deepEqual(await escaped.next(),{done:true,value:undefined});
 }finally{await db.close();}
});

live('closing cursor early sends COM_STMT_CLOSE and preserves healthy connection',async()=>{
 const db=await connectDatabase(target);
 try{
  const consumed=await db.withCursor(
   'SELECT a.n AS value FROM (SELECT 1 n UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4) a ORDER BY value',
   [],async cursor=>{
    let count=0;
    for await(const item of cursor){assert.equal(item.row.value,1n);count++;break;}
    return count;
   },{fetchSize:2});
  assert.equal(consumed,1);
  assert.equal(db.closed,false);
  assert.equal((await db.query('SELECT ? AS fresh',[91])).rows[0].fresh,91n);
 }finally{await db.close();}
});

live('cursor rejects invalid batch options and unsupported non-result statements',async()=>{
 const db=await connectDatabase(target);
 try{
  for(const fetchSize of [0,257,1.5,-1,'8']){
   await assert.rejects(db.withCursor('SELECT 1',[],async()=>{}, {fetchSize}),e=>e.code==='INVALID_INPUT');
  }
  await assert.rejects(db.withCursor('SET @nublox_cursor_rejected = 1',[],async()=>{}),
    e=>e.code==='UNSUPPORTED_FEATURE'||e.code==='DATABASE_ERROR');
  assert.equal(db.closed,false);
 }finally{await db.close();}
});

live('cancelled cursor fetch closes ambiguous socket instead of handing it back',async()=>{
 const db=await connectDatabase(target);
 const ac=new AbortController();
 const job=db.withCursor('SELECT SLEEP(?) AS slowness',[3],async cursor=>{
  for await(const _ of cursor){}
 },{fetchSize:1,signal:ac.signal});
 setTimeout(()=>ac.abort(),120);
 await assert.rejects(job,e=>e.code==='CANCELLED');
 assert.equal(db.closed,true);
 await db.close();
});

live('pooled cursor remains exclusively leased and resets cleanly on early termination',async()=>{
 const pool=createDatabasePool(target,{maxConnections:1});
 let escaped,original;
 try{
  original=await pool.withConnection(async session=>{
   const id=(await session.query('SELECT CONNECTION_ID() AS id')).rows[0].id;
   await session.withCursor('SELECT ? AS result UNION ALL SELECT ?',[22,33],async cursor=>{
    escaped=cursor;
    const head=await cursor.next();
    assert.equal(head.done,false);
    assert.equal(head.value.row.result,22n);
    // End callback without exhausting native server-side result set.
   },{fetchSize:1});
   return id;
  });
  assert.equal(escaped.closed,true);
  assert.deepEqual(await escaped.next(),{done:true,value:undefined});
  const next=await pool.withConnection(async session=>{
   assert.equal((await session.query('SELECT ? AS recovered',[44])).rows[0].recovered,44n);
   return (await session.query('SELECT CONNECTION_ID() AS id')).rows[0].id;
  });
  assert.equal(next,original,'early cursor close must not leak protocol state across leases');
 }finally{await pool.close();}
});

live('callback completion or failure with unawaited cursor fetch cannot send late wire commands',{timeout:12000},async()=>{
 for(const mode of ['return','throw']){
  const db=await connectDatabase(target);
  const originalSend=db.send.bind(db);
  const originalWireSend=db.stream.send.bind(db.stream);
  let release,entered,held=false,fetchCommands=0,closeCommands=0;
  let detached,cursor;
  const started=new Promise(resolve=>{entered=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  db.send=async body=>{
   if(body[0]===0x1c&&!held){
    held=true;
    entered();
    await gate;
   }
   return originalSend(body);
  };
  db.stream.send=async body=>{
   if(body[0]===0x1c)fetchCommands++;
   if(body[0]===0x19)closeCommands++;
   return originalWireSend(body);
  };
  try{
   const operation=db.withCursor(
    'SELECT n AS value FROM (SELECT 1 n UNION ALL SELECT 2 UNION ALL SELECT 3) t ORDER BY n',
    [],async current=>{
     cursor=current;
     detached=current.next();
     void detached.catch(()=>{});
     await started;
     if(mode==='throw')throw Error('application callback failed during fetch');
     return 'callback completed without awaiting cursor.next';
    },{fetchSize:3,timeoutMs:6000}
   );
   await assert.rejects(operation,e=>e.code==='CONNECTION_CLOSED');
   assert.equal(db.closed,true,'unawaited cursor work makes session unrecoverable: '+mode);
   assert.equal(cursor.closed,true,'escaped cursor is revoked: '+mode);
   assert.equal(closeCommands,0,'COM_STMT_CLOSE cannot race unfinished fetch: '+mode);
   release();
   await assert.rejects(detached,e=>e.code==='CONNECTION_CLOSED');
   assert.equal(fetchCommands,0,'paused fetch must not transmit after callback exit: '+mode);
   await assert.rejects(db.query('SELECT 1'),e=>e.code==='CONNECTION_CLOSED');
  }finally{
   release?.();
   db.send=originalSend;
   db.stream.send=originalWireSend;
   await db.close();
  }
 }
});

live('pooled callback failure during cursor fetch discards socket before next borrower',{timeout:12000},async()=>{
 const {ConnectionPool}=await import('../dist/core/pooling.js');
 const {connectMysql}=await import('../dist/vendors/mysql/adapter.js');
 let entered,release,held=false,detached,firstId;
 const started=new Promise(resolve=>{entered=resolve;});
 const gate=new Promise(resolve=>{release=resolve;});
 const pool=new ConnectionPool(async signal=>{
  const db=await connectMysql(target,signal);
  const originalSend=db.send.bind(db);
  db.send=async body=>{
   if(body[0]===0x1c&&!held){
    held=true;
    entered();
    await gate;
   }
   return originalSend(body);
  };
  return db;
 },{maxConnections:1,acquireTimeoutMs:8000,healthCheckTimeoutMs:2000});
 try{
  await assert.rejects(pool.withConnection(async lease=>{
   firstId=(await lease.query('SELECT CONNECTION_ID() AS id')).rows[0].id;
   await lease.withCursor(
    'SELECT n AS value FROM (SELECT 1 n UNION ALL SELECT 2 UNION ALL SELECT 3) t ORDER BY n',
    [],async cursor=>{
     detached=cursor.next();
     void detached.catch(()=>{});
     await started;
     throw Error('application cursor callback failed');
    },{fetchSize:3}
   );
  }),error=>error.code==='CONNECTION_CLOSED');
  assert.ok(pool.stats.discarded>=1,'unfinished cursor fetch must discard pooled session');
  release();
  await assert.rejects(detached,e=>e.code==='CONNECTION_CLOSED');
  const nextId=await pool.withConnection(async lease=>{
   assert.equal((await lease.query('SELECT ? AS healthy',[141])).rows[0].healthy,141n);
   return (await lease.query('SELECT CONNECTION_ID() AS id')).rows[0].id;
  });
  assert.notEqual(nextId,firstId,'next borrower must receive a new physical MySQL session');
  assert.ok(pool.stats.created>=2);
  assert.equal(pool.stats.pending,0);
  assert.ok(pool.stats.size<=1);
 }finally{
  release?.();
  await pool.close();
 }
});

live('failed cursor COM_STMT_CLOSE cannot leave an apparently healthy session',{timeout:10000},async()=>{
 const {fail}=await import('../dist/core/errors.js');
 const db=await connectDatabase(target);
 const originalClose=db.closeNative.bind(db);
 let closes=0;
 db.closeNative=async()=>{closes++;throw fail('DATABASE_ERROR','Native cursor close was not confirmed');};
 try{
  await assert.rejects(db.withCursor('SELECT ? AS cursor_value',[151],async cursor=>{
   const first=await cursor.next();
   assert.equal(first.value.row.cursor_value,151n);
  },{fetchSize:1}),e=>e.code==='DATABASE_ERROR');
  assert.equal(closes,1);
  assert.equal(db.closed,true,'unconfirmed native cleanup must discard the socket');
  await assert.rejects(db.query('SELECT 1'),e=>e.code==='CONNECTION_CLOSED');
  const next=await connectDatabase(target);
  try{
   assert.equal((await next.query('SELECT ? AS healthy',[152])).rows[0].healthy,152n);
  }finally{await next.close();}
 }finally{db.closeNative=originalClose;await db.close();}
});

live('pooled cursor close failure discards session instead of returning an unsafe lease',{timeout:10000},async()=>{
 const {ConnectionPool}=await import('../dist/core/pooling.js');
 const {connectMysql}=await import('../dist/vendors/mysql/adapter.js');
 const {fail}=await import('../dist/core/errors.js');
 let created=0,originalId;
 const pool=new ConnectionPool(async signal=>{
  const db=await connectMysql(target,signal);
  created++;
  if(created===1){
   db.closeNative=async()=>{throw fail('DATABASE_ERROR','Native cursor cleanup failed');};
  }
  return db;
 },{maxConnections:1,acquireTimeoutMs:5000,healthCheckTimeoutMs:1500});
 try{
  await assert.rejects(pool.withConnection(async lease=>{
   originalId=(await lease.query('SELECT CONNECTION_ID() AS id')).rows[0].id;
   return lease.withCursor('SELECT ? AS value',[153],async cursor=>{
    assert.equal((await cursor.next()).value.row.value,153n);
   },{fetchSize:1});
  }),e=>e.code==='DATABASE_ERROR');
  assert.ok(pool.stats.discarded>=1,'failed cleanup cannot reenter the idle pool');
  const id=await pool.withConnection(async lease=>{
   assert.equal((await lease.query('SELECT ? AS recovered',[154])).rows[0].recovered,154n);
   return (await lease.query('SELECT CONNECTION_ID() AS id')).rows[0].id;
  });
  assert.notEqual(id,originalId,'a new physical MySQL connection is required');
  assert.ok(pool.stats.created>=2);
  assert.equal(pool.stats.pending,0);
  assert.ok(pool.stats.size<=1);
 }finally{await pool.close();}
});

live('cancel or timeout during stalled cursor close retires socket without a late native command',{timeout:12000},async()=>{
 for(const mode of ['cancel','timeout']){
  const db=await connectDatabase(target);
  const originalClose=db.closeNative.bind(db);
  const originalSend=db.stream.send.bind(db.stream);
  let entered,release,closeTask,nativeCloses=0;
  const start=new Promise(resolve=>{entered=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const controller=new AbortController();
  db.stream.send=async body=>{
   if(body[0]===0x19)nativeCloses++;
   return originalSend(body);
  };
  db.closeNative=(...args)=>{
   closeTask=(async()=>{
    entered();
    await gate;
    return originalClose(...args);
   })();
   return closeTask;
  };
  try{
   const job=db.withCursor('SELECT ? AS value',[155],async cursor=>{
    assert.equal((await cursor.next()).value.row.value,155n);
   },{fetchSize:1,timeoutMs:mode==='timeout'?220:5000,signal:controller.signal});
   void job.catch(()=>{});
   await start;
   if(mode==='cancel')controller.abort();
   await assert.rejects(job,e=>e.code===(mode==='cancel'?'CANCELLED':'TIMEOUT'));
   assert.equal(db.closed,true,'interrupted close must retire session: '+mode);
   release();
   await assert.rejects(closeTask,e=>e.code==='CONNECTION_CLOSED');
   assert.equal(nativeCloses,0,'stalled close cannot write after cancellation: '+mode);
   await assert.rejects(db.query('SELECT 1'),e=>e.code==='CONNECTION_CLOSED');
  }finally{
   release?.();
   db.closeNative=originalClose;
   db.stream.send=originalSend;
   await db.close();
  }
 }
});
