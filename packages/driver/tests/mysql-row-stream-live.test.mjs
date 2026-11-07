import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {connectDatabase,createDatabasePool} from '../dist/index.js';

const live=process.env.NUBLOX_LIVE_MYSQL==='1'?test:test.skip;
const target={
  engine:'mysql',host:'127.0.0.1',port:Number(process.env.MYSQL_PORT||3306),
  user:process.env.MYSQL_USER||'root',
  password:process.env.MYSQL_PASSWORD||'test-password',
  database:'nublox_test',security:'isolated-local',timeoutMs:30000
};
const digits='(SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)';
const expression='a.n+10*b.n+100*c.n+1000*d.n+10000*e.n';
const largeSql=`SELECT ${expression} AS value FROM
 ${digits} a JOIN ${digits} b JOIN ${digits} c
 JOIN ${digits} d JOIN ${digits} e
 WHERE ${expression} < ? ORDER BY value`;

live('Node Readable streams beyond materialized row limits with demand-driven batches',
  {timeout:40000},async()=>{
  const db=await connectDatabase(target);
  try{
    const count=await db.withRowStream(largeSql,[10025],async stream=>{
      assert.equal(stream.readableObjectMode,true);
      assert.equal(stream.readableHighWaterMark,2);
      assert.deepEqual(stream.columnKeys,['value']);
      let rows=0;
      for await(const {row,values} of stream){
        assert.equal(Number(row.value),rows);
        assert.equal(Number(values[0]),rows);
        rows++;
      }
      return rows;
    },{fetchSize:37,highWaterMark:2,timeoutMs:30000});
    assert.equal(count,10025,'streaming must not inherit 10k buffered query limit');
    assert.equal(db.closed,false);
    assert.equal((await db.query('SELECT ? AS healthy',[26])).rows[0].healthy,26n);
  }finally{await db.close();}
});

live('slow Node Writable backpressure keeps queued rows bounded',async()=>{
  const db=await connectDatabase(target);
  try{
    await db.withRowStream(largeSql,[50],async stream=>{
      const observed=[];
      let maxBuffered=0;
      const sink=new Writable({
        objectMode:true,highWaterMark:1,
        write(entry,_encoding,callback){
          maxBuffered=Math.max(maxBuffered,stream.readableLength);
          observed.push(Number(entry.row.value));
          setImmediate(callback);
        }
      });
      await pipeline(stream,sink);
      assert.deepEqual(observed,Array.from({length:50},(_,i)=>i));
      assert.ok(maxBuffered<=2);
    },{fetchSize:7,highWaterMark:2});
  }finally{await db.close();}
});

live('early stream termination closes the native statement and allows reuse',async()=>{
  const db=await connectDatabase(target);
  let escaped;
  try{
    const row=await db.withRowStream(largeSql,[100],async stream=>{
      escaped=stream;
      for await(const item of stream)return item;
      throw Error('Missing row');
    },{fetchSize:9,highWaterMark:1});
    assert.equal(Number(row.values[0]),0);
    assert.equal(escaped.destroyed,true);
    assert.equal(db.closed,false);
    assert.equal((await db.query('SELECT ? AS reused',[27])).rows[0].reused,27n);
  }finally{await db.close();}
});

live('pooled row stream retains exclusive lease and resets for next borrower',async()=>{
  const pool=createDatabasePool(target,{maxConnections:1});
  let escaped;
  try{
    const original=await pool.withConnection(async session=>{
      const id=(await session.query('SELECT CONNECTION_ID() AS id')).rows[0].id;
      await session.withRowStream(largeSql,[60],async stream=>{
        escaped=stream;
        for await(const entry of stream){
          assert.equal(Number(entry.values[0]),0);
          break;
        }
      },{fetchSize:4,highWaterMark:1});
      return id;
    });
    assert.equal(escaped.destroyed,true);
    const after=await pool.withConnection(async session=>{
      assert.equal((await session.query('SELECT ? AS value',[28])).rows[0].value,28n);
      return (await session.query('SELECT CONNECTION_ID() AS id')).rows[0].id;
    });
    assert.equal(after,original);
    assert.equal(pool.stats.pending,0);
  }finally{await pool.close();}
});

live('row stream rejects invalid bounds before creating a server cursor',async()=>{
  const db=await connectDatabase(target);
  try{
    for(const highWaterMark of [0,33,-1,1.5,'8']){
      await assert.rejects(db.withRowStream('SELECT 1',[],async()=>{},{
        highWaterMark
      }),error=>error.code==='INVALID_INPUT');
    }
    await assert.rejects(db.withRowStream('SELECT 1',[],null),
      error=>error.code==='INVALID_INPUT');
    assert.equal((await db.query('SELECT ? AS ready',[29])).rows[0].ready,29n);
  }finally{await db.close();}
});

live('abort during row-stream execution retires uncertain native session',
  {timeout:10000},async()=>{
  const db=await connectDatabase(target);
  const controller=new AbortController();
  const job=db.withRowStream('SELECT SLEEP(?) AS sleep_value',[3],async stream=>{
    for await(const _ of stream){}
  },{fetchSize:1,highWaterMark:1,signal:controller.signal});
  setTimeout(()=>controller.abort(),100);
  try{
    await assert.rejects(job,error=>error.code==='CANCELLED');
    assert.equal(db.closed,true);
  }finally{await db.close();}
});
