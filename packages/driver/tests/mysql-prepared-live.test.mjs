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

live('native statement remains allocated once across repeated execution and is released on close',async()=>{
 const db=await connectDatabase(target);
 const sql='SELECT ? AS repeated';
 const inventory=async()=>{
  const result=await db.query(
   'SELECT COUNT(*) AS n FROM performance_schema.prepared_statements_instances WHERE SQL_TEXT = ?',
   [sql]
  );
  return result.rows[0].n;
 };
 try{
  assert.equal(await inventory(),0n);
  const statement=await db.prepare(sql);
  assert.equal(await inventory(),1n);
  for(let i=0;i<4;i++){
   assert.equal((await statement.execute([i])).rows[0].repeated,BigInt(i));
   assert.equal(await inventory(),1n,'repeat execution must keep the same native statement');
  }
  await statement.close();
  assert.equal(await inventory(),0n,'explicit close must release server statement');
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
   const statement=await session.prepare('SELECT SLEEP(?) AS nap');
   background=statement.execute([0.4]);
   void background.catch(()=>{});
   return id;
  });
  await assert.rejects(background,e=>e instanceof Error);
  const next=await pool.withConnection(async session=>
    (await session.query('SELECT CONNECTION_ID() AS id')).rows[0].id);
  assert.notEqual(next,first,'pool must discard connection with unawaited work');
 }finally{await pool.close();}
});

live('native statement handle count is bounded without poisoning session',async()=>{
 const db=await connectDatabase(target);
 const handles=[];
 try{
  for(let i=0;i<128;i++)handles.push(await db.prepare('SELECT ? AS value'));
  await assert.rejects(db.prepare('SELECT ? AS extra'),e=>e.code==='RESOURCE_LIMIT');
  assert.equal(db.closed,false);
  assert.equal((await handles[0].execute([88])).rows[0].value,88n);
  await handles[0].close();
  const replacement=await db.prepare('SELECT ? AS replacement');
  handles.push(replacement);
  assert.equal((await replacement.execute([89])).rows[0].replacement,89n);
 }finally{
  await Promise.all(handles.map(h=>h.close()));
  await db.close();
 }
});

live('closing a native session invalidates every open prepared statement',async()=>{
 const db=await connectDatabase(target);
 const first=await db.prepare('SELECT ? AS a');
 const second=await db.prepare('SELECT ? AS b');
 await db.close();
 assert.equal(first.closed,true);
 assert.equal(second.closed,true);
 await assert.rejects(first.execute([1]),e=>e.code==='CONNECTION_CLOSED');
 await first.close();
 await second.close();
});

live('invalid operation options never consume prepared slots or poison connection',async()=>{
 const db=await connectDatabase(target);
 try{
  for(let i=0;i<3;i++)
   await assert.rejects(db.prepare('SELECT ? AS valid',{timeoutMs:0}),e=>e.code==='INVALID_INPUT');
  const statement=await db.prepare('SELECT ? AS valid');
  try{
   await assert.rejects(statement.execute([1],{timeoutMs:0}),e=>e.code==='INVALID_INPUT');
   await assert.rejects(statement.execute([2],{signal:{aborted:0}}),e=>e.code==='INVALID_INPUT');
   assert.equal(statement.closed,false);
   assert.equal(db.closed,false);
   assert.equal((await statement.execute([3])).rows[0].valid,3n);
  }finally{await statement.close();}
 }finally{await db.close();}
});

live('concurrent prepared closes issue a single native statement close',{timeout:10000},async()=>{
 const db=await connectDatabase(target);
 const statement=await db.prepare('SELECT ? AS once');
 const original=db.closeNative.bind(db);
 let started,release;
 const entered=new Promise(resolve=>{started=resolve;});
 const gate=new Promise(resolve=>{release=resolve;});
 let closeCommands=0;
 db.closeNative=async(...args)=>{
  closeCommands++;
  started();
  await gate;
  return original(...args);
 };
 try{
  const first=statement.close();
  const second=statement.close();
  await entered;
  assert.equal(statement.closed,true);
  await assert.rejects(statement.execute([1]),e=>e.code==='CONNECTION_CLOSED');
  release();
  await Promise.all([first,second]);
  assert.equal(closeCommands,1,'one native COM_STMT_CLOSE per handle');
  assert.equal(db.closed,false);
  assert.equal((await db.query('SELECT ? AS healthy',[91])).rows[0].healthy,91n);
 }finally{
  release?.();
  db.closeNative=original;
  await db.close();
 }
});

live('prepared close queued behind interrupted execute remains idempotent',{timeout:10000},async()=>{
 const db=await connectDatabase(target);
 const statement=await db.prepare('SELECT ? AS interrupted');
 const original=db.executeNativeResults.bind(db);
 let entered,release;
 const started=new Promise(resolve=>{entered=resolve;});
 const gate=new Promise(resolve=>{release=resolve;});
 let executions=0;
 db.executeNativeResults=async(...args)=>{
  executions++;
  entered();
  await gate;
  return original(...args);
 };
 try{
  const active=statement.execute([42]);
  void active.catch(()=>{});
  await started;
  const closing=statement.close();
  const duplicate=statement.close();
  assert.equal(statement.closed,true);
  await assert.rejects(statement.execute([43]),e=>e.code==='CONNECTION_CLOSED');
  await db.close();
  release();
  await assert.rejects(active,e=>e.code==='CONNECTION_CLOSED');
  await Promise.all([closing,duplicate]);
  assert.equal(executions,1,'no queued prepared execution may be replayed');
  assert.equal(db.closed,true);
  assert.equal(statement.closed,true);
 }finally{
  release?.();
  db.executeNativeResults=original;
  await db.close();
 }
});

live('full session backlog cannot permanently orphan an explicit native prepared handle',{timeout:15000},async()=>{
 const db=await connectDatabase(target);
 const statement=await db.prepare('SELECT ? AS close_backlog_recovery');
 const original=db.executeNativeResults.bind(db);
 const originalClose=db.closeNative.bind(db);
 let entered,release,closeCommands=0,hold=true;
 const started=new Promise(resolve=>{entered=resolve;});
 const gate=new Promise(resolve=>{release=resolve;});
 const controller=new AbortController();
 db.executeNativeResults=async(...args)=>{
  if(hold){
   hold=false;
   entered();
   await gate;
  }
  return original(...args);
 };
 db.closeNative=async(...args)=>{closeCommands++;return originalClose(...args);};
 try{
  const active=statement.execute([41]);
  void active.catch(()=>{});
  await started;
  const queued=Array.from({length:1024},()=>db.query('SELECT 1',[],{signal:controller.signal}));
  const outcome=Promise.allSettled(queued);
  await assert.rejects(statement.close(),e=>e.code==='RESOURCE_LIMIT');
  assert.equal(statement.closed,false,'a close that never entered the queue must be retryable');
  assert.equal(db.statements.has(statement),true,'server statement still consumes a quota slot');
  assert.equal(closeCommands,0,'no close was transmitted while queue was saturated');
  assert.equal(db.closed,false,'queue overload must not kill unrelated active operations');
  controller.abort();
  const cancelled=await outcome;
  assert.ok(cancelled.every(x=>x.status==='rejected'&&x.reason.code==='CANCELLED'));
  release();
  assert.equal((await active).rows[0].close_backlog_recovery,41n);
  assert.equal((await statement.execute([42])).rows[0].close_backlog_recovery,42n);
  await statement.close();
  assert.equal(statement.closed,true);
  assert.equal(db.statements.has(statement),false,'successful cleanup releases the quota slot');
  assert.equal(closeCommands,1,'exactly one native COM_STMT_CLOSE');
  assert.equal(db.closed,false);
  assert.equal((await db.query('SELECT ? AS healthy',[43])).rows[0].healthy,43n);
 }finally{
  controller.abort();
  release?.();
  db.executeNativeResults=original;
  db.closeNative=originalClose;
  await statement.close().catch(()=>{});
  await db.close();
 }
});

live('queued executions cannot reuse statement IDs revoked by an earlier reset',{timeout:10000},async()=>{
 const db=await connectDatabase(target);
 const statement=await db.prepare('SELECT ? AS before_reset');
 const originalSend=db.send.bind(db);
 const originalWireSend=db.stream.send.bind(db.stream);
 let releaseReset,enteredReset,held=false,executes=0;
 const gate=new Promise(resolve=>{releaseReset=resolve;});
 const resetStarted=new Promise(resolve=>{enteredReset=resolve;});
 db.send=async body=>{
  if(body[0]===0x1f&&!held){
   held=true;
   enteredReset();
   await gate;
  }
  return originalSend(body);
 };
 db.stream.send=async body=>{
  if(body[0]===0x17)executes++;
  return originalWireSend(body);
 };
 try{
  const resetting=db.resetForPool();
  void resetting.catch(()=>{});
  await resetStarted;
  const first=statement.execute([101]);
  const second=statement.executeResults([102]);
  void first.catch(()=>{});
  void second.catch(()=>{});
  releaseReset();
  await resetting;
  assert.equal(statement.closed,true,'reset must revoke all previously created handles');
  await assert.rejects(first,e=>e.code==='CONNECTION_CLOSED');
  await assert.rejects(second,e=>e.code==='CONNECTION_CLOSED');
  assert.equal(executes,0,'neither stale statement ID may reach COM_STMT_EXECUTE');
  assert.equal(db.closed,false,'refusing stale executions must not poison a reset session');
  const fresh=await db.prepare('SELECT ? AS after_reset');
  try{
   assert.equal((await fresh.execute([103])).rows[0].after_reset,103n);
   assert.equal(executes,1,'new-generation prepared statement remains fully usable');
  }finally{await fresh.close();}
 }finally{
  releaseReset?.();
  db.send=originalSend;
  db.stream.send=originalWireSend;
  await db.close();
 }
});

live('queued close skips stale COM_STMT_CLOSE after earlier session reset',{timeout:10000},async()=>{
 const db=await connectDatabase(target);
 const statement=await db.prepare('SELECT ? AS reset_close');
 const originalSend=db.send.bind(db),originalClose=db.closeNative.bind(db);
 let enteredReset,releaseReset,held=false,closes=0;
 const started=new Promise(resolve=>{enteredReset=resolve;});
 const gate=new Promise(resolve=>{releaseReset=resolve;});
 db.send=async body=>{
  if(body[0]===0x1f&&!held){
   held=true;
   enteredReset();
   await gate;
  }
  return originalSend(body);
 };
 db.closeNative=async(...args)=>{closes++;return originalClose(...args);};
 try{
  const resetting=db.resetForPool();
  void resetting.catch(()=>{});
  await started;
  const closing=statement.close();
  void closing.catch(()=>{});
  releaseReset();
  await resetting;
  await closing;
  assert.equal(closes,0,'a reset already released the server-owned ID');
  assert.equal(statement.closed,true);
  assert.equal(db.statements.size,0);
  const replacement=await db.prepare('SELECT ? AS new_statement');
  try{
   assert.equal((await replacement.execute([104])).rows[0].new_statement,104n);
  }finally{await replacement.close();}
  assert.equal(closes,1,'only the new statement requires native cleanup');
  assert.equal(db.closed,false);
 }finally{
  releaseReset?.();
  db.send=originalSend;
  db.closeNative=originalClose;
  await db.close();
 }
});

live('executions accepted ahead of close finish in FIFO without reviving the handle',{timeout:10000},async()=>{
 const db=await connectDatabase(target);
 const statement=await db.prepare('SELECT ? AS ordered_execution');
 const originalExecute=db.executeNativeResults.bind(db);
 const originalClose=db.closeNative.bind(db);
 let started,release,held=false,closes=0;
 const firstStarted=new Promise(resolve=>{started=resolve;});
 const gate=new Promise(resolve=>{release=resolve;});
 db.executeNativeResults=async(...args)=>{
  if(!held){
   held=true;
   started();
   await gate;
  }
  return originalExecute(...args);
 };
 db.closeNative=async(...args)=>{closes++;return originalClose(...args);};
 try{
  const first=statement.execute([105]);
  void first.catch(()=>{});
  await firstStarted;
  const second=statement.executeResults([106]);
  void second.catch(()=>{});
  const closing=statement.close();
  assert.equal(statement.closed,true);
  await assert.rejects(statement.execute([107]),e=>e.code==='CONNECTION_CLOSED');
  release();
  assert.equal((await first).rows[0].ordered_execution,105n);
  assert.equal((await second)[0].rows[0].ordered_execution,106n);
  await closing;
  assert.equal(closes,1,'exactly one close follows the earlier accepted executions');
  assert.equal(db.closed,false);
  assert.equal((await db.query('SELECT ? AS ready',[108])).rows[0].ready,108n);
 }finally{
  release?.();
  db.executeNativeResults=originalExecute;
  db.closeNative=originalClose;
  await db.close();
 }
});

live('uncertain explicit prepared close retires socket for typed cleanup failures',{timeout:15000},async()=>{
 const {fail}=await import('../dist/core/errors.js');
 for(const code of ['DATABASE_ERROR','TIMEOUT','CANCELLED','RESOURCE_LIMIT']){
  const db=await connectDatabase(target);
  const statement=await db.prepare('SELECT ? AS prepared_cleanup');
  const originalClose=db.closeNative.bind(db);
  const originalWireSend=db.stream.send.bind(db.stream);
  let closeAttempts=0,lateCommands=0;
  db.closeNative=async()=>{
   closeAttempts++;
   throw fail(code,'Native prepared close did not complete');
  };
  db.stream.send=async body=>{
   if(body[0]===0x19||body[0]===0x17)lateCommands++;
   return originalWireSend(body);
  };
  try{
   const first=statement.close();
   const second=statement.close();
   const outcome=await Promise.allSettled([first,second]);
   assert.ok(outcome.every(x=>x.status==='rejected'&&x.reason.code===code),
    'original typed cleanup error must reach concurrent callers: '+code);
   assert.equal(closeAttempts,1,'one native close attempt despite concurrent callers');
   assert.equal(lateCommands,0,'no additional native statements are sent after failed close');
   assert.equal(db.closed,true,'unconfirmed close must retire physical session: '+code);
   assert.equal(statement.closed,true,'failed close cannot revive handle: '+code);
   assert.equal(statement.sessionRevoked,true,'owner session revokes the statement: '+code);
   assert.equal(db.statements.size,0,'native statement registrations are invalidated');
   if(code==='RESOURCE_LIMIT'){
    // A failed enqueue ordinarily clears the closing promise. Once the
    // native session is revoked, that path becomes an idempotent no-op.
    await statement.close();
   }else{
    await assert.rejects(statement.close(),e=>e.code===code);
   }
   assert.equal(closeAttempts,1,'repeat close must never replay uncertain cleanup');
   await assert.rejects(statement.execute([157]),e=>e.code==='CONNECTION_CLOSED');
   await assert.rejects(db.query('SELECT 1'),e=>e.code==='CONNECTION_CLOSED');
   const replacement=await connectDatabase(target);
   try{
    assert.equal((await replacement.query('SELECT ? AS healthy',[158])).rows[0].healthy,158n);
   }finally{await replacement.close();}
  }finally{
   db.closeNative=originalClose;
   db.stream.send=originalWireSend;
   await db.close();
  }
 }
});

live('pool discards connection after caught explicit prepared close failure',{timeout:10000},async()=>{
 const {ConnectionPool}=await import('../dist/core/pooling.js');
 const {connectMysql}=await import('../dist/vendors/mysql/adapter.js');
 const {fail}=await import('../dist/core/errors.js');
 let sockets=0,firstId,firstSession;
 const pool=new ConnectionPool(async signal=>{
  const db=await connectMysql(target,signal);
  sockets++;
  if(sockets===1)firstSession=db;
  return db;
 },{maxConnections:1,acquireTimeoutMs:7000,healthCheckTimeoutMs:1500});
 try{
  await pool.withConnection(async lease=>{
   firstId=(await lease.query('SELECT CONNECTION_ID() AS id')).rows[0].id;
   const statement=await lease.prepare('SELECT ? AS first');
   // Normal lease queries use their own temporary prepared statements.
   // Inject the failure only once the explicit statement is allocated.
   firstSession.closeNative=async()=>{
    throw fail('DATABASE_ERROR','Prepared close not confirmed');
   };
   await assert.rejects(statement.close(),e=>e.code==='DATABASE_ERROR');
   assert.equal(lease.closed,true,'caught cleanup errors still terminate the native lease');
   // Deliberately return successfully: pool must not park the failed socket.
  });
  assert.ok(pool.stats.discarded>=1,'uncertain close cannot enter idle pool');
  assert.equal(pool.stats.idle,0);
  const nextId=await pool.withConnection(async lease=>{
   const statement=await lease.prepare('SELECT ? AS second');
   try{assert.equal((await statement.execute([159])).rows[0].second,159n);}
   finally{await statement.close();}
   return (await lease.query('SELECT CONNECTION_ID() AS id')).rows[0].id;
  });
  assert.notEqual(firstId,nextId,'subsequent borrower must receive another physical session');
  assert.ok(pool.stats.created>=2);
  assert.equal(pool.stats.pending,0);
  assert.ok(pool.stats.size<=1);
 }finally{await pool.close();}
});
