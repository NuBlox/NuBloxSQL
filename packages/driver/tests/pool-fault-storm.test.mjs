import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ConnectionPool} from '../dist/core/pooling.js';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fake(id){
  return {
    id,closed:false,
    info:{engine:'mysql',model:'relational',version:'test',capabilities:[]},
    async healthCheckForPool(){if(this.closed)throw Error('closed');},
    async resetForPool(){if(this.closed)throw Error('closed');},
    async query(){
      if(this.closed)throw Error('closed');
      return {rows:[{id}],columns:[],affectedRows:0,insertId:0};
    },
    async close(){this.closed=true;}
  };
}

test('application exception survives a simultaneous native disposal failure',{timeout:3000},async()=>{
  const original=new Error('application transaction rejected');
  const session=fake(1);
  let closeCalls=0;
  session.close=async()=>{
    closeCalls++;
    session.closed=true;
    throw Error('transport close also failed');
  };
  const pool=new ConnectionPool(async()=>session,{maxConnections:1});
  try{
    await assert.rejects(
      pool.withConnection(async lease=>{
        await lease.query('SELECT 1');
        throw original;
      }),
      error=>error===original,
      'the application error must not be replaced by its cleanup error'
    );
    assert.equal(closeCalls,1);
    assert.equal(pool.stats.discarded,1);
    assert.equal(pool.stats.size,0);
  }finally{await pool.close();}
});

test('successful work still reports a native disposal failure',{timeout:3000},async()=>{
  const session=fake(1);
  session.resetForPool=async()=>{throw Error('reset fault');};
  session.close=async()=>{
    session.closed=true;
    throw Error('transport close failed');
  };
  const pool=new ConnectionPool(async()=>session,{maxConnections:1});
  try{
    await assert.rejects(pool.withConnection(async lease=>{
      await lease.query('SELECT 1');
      return 'success';
    }),/transport close failed/);
    assert.equal(pool.stats.size,0);
    assert.equal(pool.stats.discarded,1);
  }finally{await pool.close();}
});

test('256 concurrent borrowers recover through injected dial, health and callback faults',{timeout:15000},async()=>{
  const maxConnections=4;
  let attempts=0,open=0,peak=0,callbacks=0,queryCalls=0;
  const pool=new ConnectionPool(async()=>{
    const id=++attempts;
    if(id%11===0)throw Error('injected dial failure');
    const session=fake(id);
    open++;
    peak=Math.max(peak,open);
    session.healthCheckForPool=async()=>{
      if(id%13===0)throw Error('injected health failure');
    };
    session.query=async()=>{
      queryCalls++;
      await sleep(1);
      if(session.closed)throw Error('query on closed session');
      return {rows:[{id}],columns:[],affectedRows:0,insertId:0};
    };
    session.close=async()=>{
      await sleep(1);
      if(!session.closed){
        session.closed=true;
        open--;
      }
    };
    return session;
  },{maxConnections,acquireTimeoutMs:10000});
  try{
    const requests=Array.from({length:256},(_,i)=>
      pool.withConnection(async lease=>{
        callbacks++;
        const result=await lease.query('SELECT id');
        assert.ok(result.rows[0].id>0);
        if(i%23===0)throw Error('injected callback failure');
        return i;
      })
    );
    const outcomes=await Promise.allSettled(requests);
    const passed=outcomes.filter(x=>x.status==='fulfilled').length;
    const rejected=outcomes.filter(x=>x.status==='rejected');
    assert.ok(passed>150,'healthy operations should progress through intermittent faults');
    assert.ok(rejected.length>0,'faults must be observable, not silently retried');
    assert.ok(pool.stats.healthFailures>0,'bad health probes must be counted');
    assert.ok(attempts>pool.stats.created,'failed connection attempts must be visible');
    assert.ok(peak<=maxConnections,'simultaneously open native connections must stay bounded');
    assert.equal(queryCalls,callbacks,'application queries must never be replayed');
    assert.equal(pool.stats.pending,0);
    assert.equal(pool.stats.connecting,0);
    assert.ok(pool.stats.size<=maxConnections);
    assert.equal(open,pool.stats.size);
  }finally{await pool.close();}
  assert.equal(open,0,'every native session must be closed at shutdown');
  assert.equal(pool.stats.size,0);
});

test('cancellation storm does not poison the held session or later borrowers',{timeout:5000},async()=>{
  let release,entered;
  const gate=new Promise(resolve=>{release=resolve;});
  const started=new Promise(resolve=>{entered=resolve;});
  let created=0;
  const pool=new ConnectionPool(async()=>fake(++created),{
    maxConnections:1,acquireTimeoutMs:140
  });
  const active=pool.withConnection(async lease=>{
    entered();
    await gate;
    return (await lease.query('SELECT healthy')).rows[0].id;
  });
  try{
    await started;
    const storms=Array.from({length:160},()=>pool.withConnection(async()=>{
      throw Error('timed out borrower must not enter callback');
    }));
    assert.equal(pool.stats.pending,160);
    const results=await Promise.allSettled(storms);
    assert.ok(results.every(x=>x.status==='rejected'&&x.reason.code==='TIMEOUT'));
    assert.equal(pool.stats.acquireTimeouts,160);
    assert.equal(pool.stats.pending,0);
    assert.equal(pool.stats.size,1);
    release();
    assert.equal(await active,1);
    const next=await pool.withConnection(async lease=>
      (await lease.query('SELECT recovered')).rows[0].id);
    assert.equal(next,1,'queued timeouts must not destroy the active connection');
    assert.equal(created,1);
    assert.equal(pool.stats.healthFailures,0);
  }finally{
    release?.();
    await active.catch(()=>{});
    await pool.close();
  }
  assert.equal(pool.stats.size,0);
});
