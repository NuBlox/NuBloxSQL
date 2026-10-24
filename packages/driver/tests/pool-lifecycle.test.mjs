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

test('acquisition deadline includes in-flight connection establishment',{timeout:3000},async()=>{
  let accept,attempts=0,entered=false;
  const dial=new Promise(resolve=>{accept=resolve;});
  const pool=new ConnectionPool(()=>{
    attempts++;
    return attempts===1?dial:Promise.resolve(fake(attempts));
  },{maxConnections:1,acquireTimeoutMs:120});
  try{
    const request=pool.withConnection(async()=>{entered=true;});
    await sleep(10);
    assert.equal(pool.stats.connecting,1);
    await assert.rejects(request,e=>e.code==='TIMEOUT');
    assert.equal(entered,false);
    assert.equal(pool.stats.acquireTimeouts,1);
    assert.equal(pool.stats.size,1,'unresolved physical dial still reserves capacity');
    assert.equal(pool.stats.connecting,1);
    assert.equal(pool.stats.pending,0);
    const late=fake(1);
    accept(late);
    await sleep(15);
    assert.equal(late.closed,true,'late session must never be leased');
    assert.equal(pool.stats.size,0);
    assert.equal(pool.stats.connecting,0);
    assert.equal(pool.stats.discarded,1);
    const id=await pool.withConnection(async session=>(await session.query('id')).rows[0].id);
    assert.equal(id,2);
    assert.equal(pool.stats.created,1);
  }finally{await pool.close();}
});

test('a late failed dial after deadline settles only once',{timeout:3000},async()=>{
  let rejectDial,attempts=0;
  const dial=new Promise((_,reject)=>{rejectDial=reject;});
  const pool=new ConnectionPool(()=>{
    attempts++;
    return attempts===1?dial:Promise.resolve(fake(attempts));
  },{maxConnections:1,acquireTimeoutMs:110});
  try{
    await assert.rejects(pool.withConnection(async()=> 'never'),e=>e.code==='TIMEOUT');
    assert.equal(pool.stats.size,1);
    rejectDial(Error('delayed connection failure'));
    await sleep(15);
    assert.equal(pool.stats.size,0);
    assert.equal(pool.stats.connecting,0);
    assert.equal(pool.stats.acquireTimeouts,1);
    assert.equal(await pool.withConnection(async s=>(await s.query('id')).rows[0].id),2);
  }finally{await pool.close();}
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
  await assert.rejects(request,e=>e.code==='CONNECTION_CLOSED');
  assert.equal(pool.stats.connecting,1,'in-flight dial remains accounted for');
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

test('cooperative dial is aborted on acquire timeout and frees its slot',{timeout:3000},async()=>{
  let attempts=0,abortCount=0,entered=false;
  const pool=new ConnectionPool(signal=>{
    attempts++;
    if(attempts>1)return Promise.resolve(fake(attempts));
    return new Promise((_,reject)=>{
      const aborted=()=>{abortCount++;reject(Error('dial aborted'));};
      signal.addEventListener('abort',aborted,{once:true});
      if(signal.aborted)aborted();
    });
  },{maxConnections:1,acquireTimeoutMs:110});
  try{
    await assert.rejects(pool.withConnection(async()=>{entered=true;}),e=>e.code==='TIMEOUT');
    await sleep(10);
    assert.equal(entered,false);
    assert.equal(abortCount,1,'the in-progress connector must receive one abort');
    assert.equal(pool.stats.connecting,0);
    assert.equal(pool.stats.size,0);
    assert.equal(pool.stats.acquireTimeouts,1);
    assert.equal(await pool.withConnection(async s=>(await s.query('id')).rows[0].id),2);
    assert.equal(pool.stats.created,1);
  }finally{await pool.close();}
});

test('shutdown aborts an active cooperative dial and rejects checkout promptly',{timeout:3000},async()=>{
  let aborted=0,entered=false;
  const pool=new ConnectionPool(signal=>new Promise((_,reject)=>{
    const cancel=()=>{aborted++;reject(Error('dial aborted'));};
    signal.addEventListener('abort',cancel,{once:true});
    if(signal.aborted)cancel();
  }),{maxConnections:1,acquireTimeoutMs:2000});
  const request=pool.withConnection(async()=>{entered=true;});
  await sleep(10);
  assert.equal(pool.stats.connecting,1);
  await pool.close();
  await assert.rejects(request,e=>e.code==='CONNECTION_CLOSED');
  await sleep(10);
  assert.equal(entered,false);
  assert.equal(aborted,1);
  assert.equal(pool.stats.size,0);
  assert.equal(pool.stats.connecting,0);
  assert.equal(pool.closed,true);
});

test('concurrent shutdown callers join one native close and await its completion',{timeout:3000},async()=>{
  const session=fake(1);
  let closeCalls=0,notifyClose,finishClose;
  const closeStarted=new Promise(resolve=>{notifyClose=resolve;});
  const closeGate=new Promise(resolve=>{finishClose=resolve;});
  session.close=async()=>{
    closeCalls++;
    notifyClose();
    await closeGate;
    session.closed=true;
  };
  const pool=new ConnectionPool(async()=>session,{maxConnections:1});
  try{
    await pool.withConnection(async lease=>lease.query('SELECT 1'));
    const first=pool.close();
    await closeStarted;
    const second=pool.close();
    assert.strictEqual(first,second,'every shutdown caller must receive one shared promise');
    let settled=false;
    void second.then(()=>{settled=true;});
    await sleep(10);
    assert.equal(settled,false,'shutdown promise cannot resolve before transport closes');
    assert.equal(closeCalls,1);
    finishClose();
    await Promise.all([first,second]);
    assert.equal(session.closed,true);
    assert.equal(closeCalls,1);
    assert.equal(pool.stats.size,0);
    assert.equal(pool.closed,true);
  }finally{
    finishClose?.();
    await pool.close();
  }
});

test('pool shutdown during session reset preserves completed callback result',{timeout:3000},async()=>{
  const session=fake(1);
  let resetStarted,rejectReset;
  const enteredReset=new Promise(resolve=>{resetStarted=resolve;});
  let closes=0;
  session.resetForPool=()=>{
    resetStarted();
    return new Promise((_,reject)=>{rejectReset=reject;});
  };
  session.close=async()=>{
    closes++;
    session.closed=true;
    rejectReset?.(Error('reset interrupted by shutdown'));
  };
  const pool=new ConnectionPool(async()=>session,{maxConnections:1});
  try{
    const work=pool.withConnection(async lease=>{
      await lease.query('SELECT 1');
      return 'application-success';
    });
    await enteredReset;
    const closing=pool.close();
    assert.equal(await work,'application-success');
    await closing;
    assert.equal(closes,1,'pool shutdown owns disposal and must not double-close');
    assert.equal(pool.stats.size,0);
    assert.equal(pool.closed,true);
  }finally{
    rejectReset?.(Error('test cleanup'));
    await pool.close();
  }
});

test('reset failure outside shutdown still discards an unhealthy session',{timeout:3000},async()=>{
  const session=fake(1);
  session.resetForPool=async()=>{throw Error('reset failed');};
  const pool=new ConnectionPool(async()=>session,{maxConnections:1});
  try{
    await assert.rejects(pool.withConnection(async lease=>{
      await lease.query('SELECT 1');
      return 'callback-finished';
    }),error=>error.code==='CONNECTION_FAILED');
    assert.equal(session.closed,true);
    assert.equal(pool.stats.size,0);
    assert.equal(pool.stats.discarded,1);
  }finally{await pool.close();}
});
