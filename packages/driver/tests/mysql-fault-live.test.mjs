import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {connectDatabase} from '../dist/index.js';
import {ConnectionPool} from '../dist/core/pooling.js';

const live=process.env.NUBLOX_LIVE_MYSQL==='1'?test:test.skip;
const target={
 engine:'mysql',host:'127.0.0.1',port:Number(process.env.MYSQL_PORT||3306),
 user:process.env.MYSQL_USER||'root',password:process.env.MYSQL_PASSWORD||'test-password',
 database:'nublox_test',security:'isolated-local',timeoutMs:6000
};
const breakTransport=async session=>{
 // Explicit, test-only fault injection at the real authenticated transport.
 // The production Driver exposes no socket access in its public contract.
 const close=once(session.socket,'close');
 session.socket.destroy();
 await close;
};

live('unexpected idle server transport loss invalidates session and outstanding prepared handles',async()=>{
 const db=await connectDatabase(target);
 const statement=await db.prepare('SELECT ? AS safely_prepared');
 try{
  assert.equal((await statement.execute([1])).rows[0].safely_prepared,1n);
  await breakTransport(db);
  assert.equal(db.closed,true,'idle socket failure must invalidate session immediately');
  assert.equal(statement.closed,true);
  await assert.rejects(db.query('SELECT 1'),e=>e.code==='CONNECTION_CLOSED');
  await assert.rejects(statement.execute([2]),e=>e.code==='CONNECTION_CLOSED');
 }finally{await db.close();}
});

live('active query disconnect rejects immediately and also rejects queued operations',async()=>{
 const db=await connectDatabase(target);
 try{
  const slow=db.query('SELECT SLEEP(?) AS sleep_result',[3]);
  const queued=db.query('SELECT ? AS should_not_run',[4]);
  // Register rejection observers immediately; the fault can surface before assertions.
  void slow.catch(()=>{});
  void queued.catch(()=>{});
  await new Promise(resolve=>setTimeout(resolve,100));
  await breakTransport(db);
  await assert.rejects(slow,e=>e.code==='CONNECTION_CLOSED');
  await assert.rejects(queued,e=>e.code==='CONNECTION_CLOSED');
  assert.equal(db.closed,true);
 }finally{await db.close();}
});

live('a lost COMMIT acknowledgement returns unknown outcome and never retries the write',async()=>{
 const db=await connectDatabase(target);
 const table='nublox_fault_'+randomUUID().replaceAll('-','').slice(0,20);
 let commitCommands=0;
 try{
  await db.query(`CREATE TABLE \`${table}\` (id INT PRIMARY KEY, value INT) ENGINE=InnoDB`);
  const wire=db.stream;
  const originalSend=wire.send.bind(wire);
  wire.send=async body=>{
   const committing=body[0]===0x03&&body.subarray(1).toString('ascii')==='COMMIT';
   if(committing){commitCommands++;db.socket.pause();}
   await originalSend(body);
   if(committing)db.socket.destroy(); // block any trustworthy COMMIT response
  };
  await assert.rejects(db.transaction(async tx=>{
   await tx.query(`INSERT INTO \`${table}\` (id,value) VALUES (?,?)`,[214,22]);
  }),e=>e.code==='TRANSACTION_OUTCOME_UNKNOWN'&&/unknown/.test(e.message));
  assert.equal(commitCommands,1,'the Driver must never resend COMMIT');
  assert.equal(db.closed,true,'unknown outcome session cannot be reused');
  const verifier=await connectDatabase(target);
  try{
   const row=await verifier.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE id = ?`,[214]);
   assert.ok(row.rows[0].n===0n||row.rows[0].n===1n,
     'a lost acknowledgement cannot prove whether the commit happened');
  }finally{await verifier.close();}
 }finally{
  await db.close();
  // Always clean up test-owned DDL with a new healthy session.
  const cleanup=await connectDatabase(target);
  try{await cleanup.query(`DROP TABLE IF EXISTS \`${table}\``);}
  finally{await cleanup.close();}
 }
});

live('pooled idle disconnect is discarded and only a fresh connection is borrowed',async()=>{
 const created=[];
 const pool=new ConnectionPool(async()=>{
  const db=await connectDatabase(target);
  created.push(db);
  return db;
 },{maxConnections:1,acquireTimeoutMs:2000});
 try{
  const first=await pool.withConnection(async db=>
   (await db.query('SELECT CONNECTION_ID() AS id')).rows[0].id);
  assert.equal(pool.stats.idle,1);
  await breakTransport(created[0]);
  assert.equal(created[0].closed,true);
  const second=await pool.withConnection(async db=>
   (await db.query('SELECT CONNECTION_ID() AS id')).rows[0].id);
  assert.notEqual(second,first);
  assert.equal(pool.stats.created,2);
  assert.ok(pool.stats.discarded>=1);
  assert.equal(pool.stats.pending,0);
 }finally{await pool.close();}
});

live('normal acknowledged transaction still commits and leaves session healthy',async()=>{
 const db=await connectDatabase(target);
 try{
  const outcome=await db.transaction(async tx=>{
   assert.equal((await tx.query('SELECT ? AS inside',[45])).rows[0].inside,45n);
   return 'confirmed';
  });
  assert.equal(outcome,'confirmed');
  assert.equal(db.closed,false);
  assert.equal((await db.query('SELECT ? AS next',[46])).rows[0].next,46n);
 }finally{await db.close();}
});


live('large native MySQL result interrupted mid-transfer fails closed, next connection recovers',async()=>{
 const db=await connectDatabase({...target,timeoutMs:12000});
 let pending;
 try{
  // MySQL returns a result larger than one 24-bit physical frame.
  pending=db.query('SELECT REPEAT(?,?) AS payload',['x',20_000_000]);
  void pending.catch(()=>{});
  // Destroy after the result command is sent and the peer starts transmitting.
  await new Promise(resolve=>setTimeout(resolve,20));
  await breakTransport(db);
  await assert.rejects(pending,e=>e.code==='CONNECTION_CLOSED');
  assert.equal(db.closed,true);
  const replacement=await connectDatabase(target);
  try{
   assert.equal((await replacement.query('SELECT ? AS recovered',[123])).rows[0].recovered,123n);
  }finally{await replacement.close();}
 }finally{await db.close();}
});

live('many pooled requests survive deliberate callback errors and retain bounded capacity',async()=>{
 const {createDatabasePool}=await import('../dist/index.js');
 const pool=createDatabasePool(target,{maxConnections:3,acquireTimeoutMs:6000});
 let callbacks=0;
 try{
  const attempts=await Promise.all(Array.from({length:36},(_,i)=>
   pool.withConnection(async db=>{
     callbacks++;
     assert.equal((await db.query('SELECT ? AS value',[i])).rows[0].value,BigInt(i));
     if(i%6===0)throw Error('expected-application-failure');
   }).then(()=> 'ok',error=>error.message==='expected-application-failure'?'expected':'unexpected')
  ));
  assert.equal(attempts.filter(x=>x==='expected').length,6);
  assert.equal(attempts.filter(x=>x==='unexpected').length,0);
  assert.equal(callbacks,36);
  assert.equal(pool.stats.pending,0);
  assert.ok(pool.stats.size<=3);
  assert.ok(pool.stats.discarded>=6);
 }finally{await pool.close();}
 assert.equal(pool.stats.size,0);
});
