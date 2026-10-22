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
    for await(const item of cursor){assert.equal(item.row.value,1);count++;break;}
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
    e=>e.code==='UNSUPPORTED_FEATURE');
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
