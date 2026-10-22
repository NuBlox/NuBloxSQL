import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ConnectionPool} from '../dist/core/pooling.js';

function fake(id,{probeFails=false}={}){
  return {
    id,closed:false,probes:0,resets:0,
    info:{engine:'mysql',model:'relational',version:'test',capabilities:[]},
    async healthCheckForPool(){
      this.probes++;
      if(this.closed||probeFails)throw Error('stale connection');
    },
    async resetForPool(){this.resets++;if(this.closed)throw Error('closed');},
    async query(){if(this.closed)throw Error('closed');return {rows:[{id}],columns:[],affectedRows:0,insertId:0};},
    async prepare(){throw Error('unused');},
    async transaction(cb){return cb(this);},
    async close(){this.closed=true;}
  };
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('idle expiration retires a connection and reserves no slots',async()=>{
  let count=0;
  const sessions=[];
  const pool=new ConnectionPool(async()=>{
    const item=fake(++count);sessions.push(item);return item;
  },{maxConnections:1,idleTimeoutMs:110});
  try{
    const first=await pool.withConnection(async session=>(await session.query('id')).rows[0].id);
    assert.equal(first,1);
    assert.equal(pool.stats.idle,1);
    await sleep(240);
    assert.equal(pool.stats.expired,1);
    assert.equal(pool.stats.discarded,1);
    assert.equal(pool.stats.size,0);
    assert.equal(pool.stats.idle,0);
    assert.equal(sessions[0].closed,true);
    const second=await pool.withConnection(async session=>(await session.query('id')).rows[0].id);
    assert.equal(second,2);
    assert.equal(pool.stats.created,2);
  }finally{await pool.close();}
});

test('stale socket is probed, discarded and replaced once before application SQL',async()=>{
  const made=[];
  const pool=new ConnectionPool(async()=>{
    const item=fake(made.length+1);made.push(item);return item;
  },{maxConnections:1});
  try{
    await pool.withConnection(async session=>assert.equal((await session.query('id')).rows[0].id,1));
    const original=made[0];
    original.healthCheckForPool=async()=>{throw Error('server disconnected');};
    await pool.withConnection(async session=>assert.equal((await session.query('id')).rows[0].id,2));
    assert.equal(original.closed,true);
    assert.equal(pool.stats.healthFailures,1);
    assert.equal(pool.stats.created,2);
    assert.equal(pool.stats.discarded,1);
    assert.equal(pool.stats.size,1);
  }finally{await pool.close();}
});

test('checkout retries stale health only once and never enters callback with bad connection',async()=>{
  let count=0,entered=false;
  const pool=new ConnectionPool(async()=>fake(++count,{probeFails:true}),{maxConnections:1});
  try{
    await assert.rejects(pool.withConnection(async()=>{entered=true;}),e=>e.code==='CONNECTION_FAILED');
    assert.equal(entered,false);
    assert.equal(count,2);
    assert.equal(pool.stats.healthFailures,2);
    assert.equal(pool.stats.discarded,2);
    assert.equal(pool.stats.size,0);
  }finally{await pool.close();}
});

test('bounded FIFO pool reports waiting, timeout and active state',async()=>{
  const pool=new ConnectionPool(async()=>fake(1),{maxConnections:1,acquireTimeoutMs:120});
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  let entered;
  const start=new Promise(resolve=>{entered=resolve;});
  const held=pool.withConnection(async()=>{
    entered();
    await gate;
  });
  try{
    await start;
    assert.equal(pool.stats.active,1);
    await assert.rejects(pool.withConnection(async()=>0),e=>e.code==='TIMEOUT');
    assert.equal(pool.stats.acquireTimeouts,1);
    assert.equal(pool.stats.size,1);
    assert.equal(pool.stats.connecting,0);
    const snapshot=pool.stats;
    assert.ok(Object.isFrozen(snapshot));
  }finally{
    release();
    await held;
    await pool.close();
  }
  assert.equal(pool.stats.size,0);
});

test('closing during an in-progress dial disposes late session without leaked slot',async()=>{
  let accept;
  const dial=new Promise(resolve=>{accept=resolve;});
  const pool=new ConnectionPool(()=>dial,{maxConnections:1});
  const request=pool.withConnection(async()=>{throw Error('must not run');});
  // Dispatch schedules connect in the next microtask.
  await sleep(10);
  assert.equal(pool.stats.connecting,1);
  await pool.close();
  assert.equal(pool.closed,true);
  const late=fake(99);
  accept(late);
  await assert.rejects(request,e=>e.code==='CONNECTION_CLOSED');
  await sleep(10);
  assert.equal(late.closed,true);
  assert.equal(pool.stats.connecting,0);
  assert.equal(pool.stats.size,0);
  assert.equal(pool.stats.active,0);
});


test('nested callback acquire rejects before waiting; escaped child async scope is inactive',async()=>{
 let connections=0,late;
 const pool=new ConnectionPool(async()=>fake(++connections),{
  maxConnections:1,acquireTimeoutMs:150
 });
 try{
  const id=await pool.withConnection(async lease=>{
   await assert.rejects(pool.withConnection(async()=> 'never'),error=>
     error.code==='INVALID_INPUT');
   late=new Promise((resolve,reject)=>setTimeout(()=>{
     pool.withConnection(async next=>(await next.query('after')).rows[0].id)
       .then(resolve,reject);
   },20));
   return (await lease.query('before')).rows[0].id;
  });
  assert.equal(await late,id);
  assert.equal(pool.stats.created,1);
  assert.equal(pool.stats.acquireTimeouts,0);
 }finally{await pool.close();}
});
