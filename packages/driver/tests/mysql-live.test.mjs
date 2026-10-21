import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectDatabase} from '../dist/index.js';
const live=process.env.NUBLOX_LIVE_MYSQL==='1'?test:test.skip;
const target={engine:'mysql',host:'127.0.0.1',port:Number(process.env.MYSQL_PORT||3306),user:process.env.MYSQL_USER||'root',password:process.env.MYSQL_PASSWORD||'test-password',database:'nublox_test',security:'isolated-local',timeoutMs:15000};

live('MySQL 8.4 real handshake, prepared statements, type fidelity, errors and rollback',async()=>{
 const db=await connectDatabase(target);
 try{
  assert.match(db.info.version,/^8\.4\./);
  const basic=await db.query('SELECT ? AS label, ? AS amount, ? AS nullable',['hello',42,null]);
  assert.equal(basic.rows[0].label,'hello');assert.equal(basic.rows[0].amount,42n);
  assert.equal(basic.rows[0].nullable,null);
  const version=await db.query('SELECT VERSION() AS server_version');
  assert.match(version.rows[0].server_version,/^8\.4\./);
  await db.query('CREATE TEMPORARY TABLE nublox_native_test (id INT PRIMARY KEY,label VARCHAR(255),amount DECIMAL(20,5),bin VARBINARY(255))');
  await db.transaction(async tx=>{await tx.query('INSERT INTO nublox_native_test (id,label,amount,bin) VALUES (?,?,?,?)',[1,'safe','123456789.12345',Buffer.from([0,255])]);});
  await assert.rejects(db.transaction(async tx=>{await tx.query('INSERT INTO nublox_native_test (id,label) VALUES (?,?)',[2,'rollback']);throw Error('cancel transaction');}),/cancel transaction/);
  const result=await db.query('SELECT label,amount,bin FROM nublox_native_test WHERE id = ?',[1]);
  assert.equal(result.rows[0].label,'safe');assert.equal(result.rows[0].amount,'123456789.12345');
  assert.deepEqual(result.rows[0].bin,Buffer.from([0,255]));
  assert.equal((await db.query('SELECT id FROM nublox_native_test WHERE id = ?',[2])).rows.length,0);
  assert.equal((await db.query('SELECT id FROM nublox_native_test WHERE label = ?',["safe' OR 1=1 --"])).rows.length,0);
  await assert.rejects(db.query('SELECT * FROM missing_nublox_table'),e=>e.code==='DATABASE_ERROR'&&e.vendorCode>0);
  assert.equal((await db.query('SELECT ? AS again',[7])).rows[0].again,7n);
 }finally{await db.close();}assert.equal(db.closed,true);
});


live('pre-aborted operation is rejected without damaging its idle connection',async()=>{
 const db=await connectDatabase(target);
 try{
  const controller=new AbortController();
  controller.abort();
  await assert.rejects(db.query('SELECT 1',[],{signal:controller.signal}),e=>e.code==='CANCELLED');
  assert.equal(db.closed,false);
  assert.equal((await db.query('SELECT ? AS good',[17])).rows[0].good,17n);
 }finally{await db.close();}
});

live('pending operation can be cancelled promptly without interrupting active query',async()=>{
 const db=await connectDatabase(target);
 try{
  const slow=db.query('SELECT SLEEP(0.5) AS slept');
  const controller=new AbortController();
  const queued=db.query('SELECT ? AS cancelled',[1],{signal:controller.signal});
  controller.abort();
  await assert.rejects(queued,e=>e.code==='CANCELLED');
  assert.equal(db.closed,false);
  assert.equal((await slow).rows[0].slept,0n);
  assert.equal((await db.query('SELECT ? AS good',[18])).rows[0].good,18n);
 }finally{await db.close();}
});

live('in-flight cancellation aborts server I/O and prevents reuse',async()=>{
 const db=await connectDatabase(target);
 const controller=new AbortController();
 const started=Date.now();
 const pending=db.query('SELECT SLEEP(3) AS slept',[],{signal:controller.signal});
 setTimeout(()=>controller.abort(),120);
 await assert.rejects(pending,e=>e.code==='CANCELLED');
 assert.ok(Date.now()-started<2500,'cancellation must not wait for server SLEEP');
 assert.equal(db.closed,true);
 await assert.rejects(db.query('SELECT 1'),e=>e.code==='CONNECTION_CLOSED');
 await db.close();
});

live('per-operation timeout interrupts slow query and closes its connection',async()=>{
 const db=await connectDatabase(target);
 const started=Date.now();
 await assert.rejects(
   db.query('SELECT SLEEP(3) AS slept',[],{timeoutMs:150}),
   e=>e.code==='TIMEOUT'
 );
 assert.ok(Date.now()-started<2500,'deadline must interrupt network operation');
 assert.equal(db.closed,true);
 await db.close();
});

live('invalid per-operation deadline is rejected without closing session',async()=>{
 const db=await connectDatabase(target);
 try{
  await assert.rejects(db.query('SELECT 1',[],{timeoutMs:0}),e=>e.code==='INVALID_INPUT');
  assert.equal(db.closed,false);
  assert.equal((await db.query('SELECT 1 AS valid')).rows[0].valid,1n);
 }finally{await db.close();}
});

live('explicit close interrupts running and queued operations promptly',async()=>{
 const db=await connectDatabase(target);
 const started=Date.now();
 const slow=db.query('SELECT SLEEP(3) AS slept');
 const queued=db.query('SELECT ? AS waiting',[2]);
 await db.close();
 await assert.rejects(slow,e=>e.code==='CONNECTION_CLOSED');
 await assert.rejects(queued,e=>e.code==='CONNECTION_CLOSED');
 assert.ok(Date.now()-started<2500,'close must not wait for an active server command');
 assert.equal(db.closed,true);
 await db.close();
});

live('transaction cancellation closes ambiguous in-flight transaction',async()=>{
 const db=await connectDatabase(target);
 const controller=new AbortController();
 const operation=db.transaction(async tx=>{
   await tx.query('SELECT SLEEP(3) AS slept');
 },{signal:controller.signal});
 setTimeout(()=>controller.abort(),100);
 await assert.rejects(operation,e=>e.code==='CANCELLED');
 assert.equal(db.closed,true);
 await db.close();
});

live('ordinary transaction callback error rolls back and keeps session healthy',async()=>{
 const db=await connectDatabase(target);
 try{
  await assert.rejects(db.transaction(async()=>{throw Error('application rejected');}),/application rejected/);
  assert.equal(db.closed,false);
  assert.equal((await db.query('SELECT ? AS value',[8])).rows[0].value,8n);
 }finally{await db.close();}
});
