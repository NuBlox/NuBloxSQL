import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PacketStream} from '../dist/vendors/mysql/protocol/framing.js';
import {MysqlSession} from '../dist/vendors/mysql/adapter.js';
import {ConnectionPool} from '../dist/core/pooling.js';
import {fail} from '../dist/core/errors.js';

const result={rows:[],columns:[],affectedRows:0,insertId:0};

class FixtureSocket extends EventEmitter {
  destroyed=false;
  destroy(){
    if(!this.destroyed){
      this.destroyed=true;
      this.emit('close');
    }
    return this;
  }
}

function fixture(statementCacheSize=0){
  const socket=new FixtureSocket();
  const stream=new PacketStream(socket);
  const session=new MysqlSession(stream,socket,{
    engine:'mysql',host:'127.0.0.1',port:3306,user:'fixture',
    password:'',database:'',security:'isolated-local',timeoutMs:2000,
    statementCacheSize
  },{
    version:'8.4.11-fixture',plugin:'caching_sha2_password',
    seed:Buffer.alloc(20),id:1,flags:0
  });
  // Exercise the real executeResults/serial lifecycle without sending
  // synthetic MySQL frames into an unconnected socket.
  session.prepareNative=async()=>({id:73,parameterCount:0});
  session.executeNativeResults=async()=>[result];
  return {session,socket};
}

test('implicit COM_STMT_CLOSE errors revoke a successful query session',async()=>{
  for(const code of ['DATABASE_ERROR','RESOURCE_LIMIT','CANCELLED','TIMEOUT']){
    const {session,socket}=fixture();
    let closeAttempts=0;
    session.closeNative=async()=>{
      closeAttempts++;
      throw fail(code,'synthetic native close failure');
    };
    await assert.rejects(session.query('SELECT 1'),error=>error.code===code);
    assert.equal(closeAttempts,1,code+': no cleanup replay');
    assert.equal(session.closed,true,code+': session must be revoked');
    assert.equal(socket.destroyed,true,code+': physical socket must be closed');
    await assert.rejects(session.queryResults('SELECT 2'),
      error=>error.code==='CONNECTION_CLOSED');
    await session.close();
  }
});

test('an original SQL error remains primary when implicit cleanup also fails',async()=>{
  const {session,socket}=fixture();
  const original=fail('DATABASE_ERROR','original database error');
  session.executeNativeResults=async()=>{throw original;};
  let closeAttempts=0;
  session.closeNative=async()=>{
    closeAttempts++;
    throw fail('RESOURCE_LIMIT','cleanup failed');
  };
  await assert.rejects(session.queryResults('invalid SQL'),error=>error===original);
  assert.equal(closeAttempts,1,'cleanup attempted once, never retried');
  assert.equal(session.closed,true,'failed cleanup revokes the connection');
  assert.equal(socket.destroyed,true);
  await session.close();
});

test('confirmed implicit COM_STMT_CLOSE retains a healthy reusable session',async()=>{
  const {session,socket}=fixture();
  let closed=0;
  session.closeNative=async()=>{closed++;};
  assert.deepEqual(await session.query('SELECT 1'),result);
  assert.deepEqual(await session.queryResults('SELECT 2'),[result]);
  assert.equal(closed,2);
  assert.equal(session.closed,false);
  assert.equal(socket.destroyed,false);
  await session.close();
});

test('pool never reuses a session after implicit close fails',async()=>{
  let count=0;
  const sessions=[];
  const pool=new ConnectionPool(async()=>{
    const {session,socket}=fixture();
    const index=++count;
    sessions.push({session,socket});
    // Only fixture setup is stubbed: lease, serial, cleanup, and disposal
    // remain real, so this detects pool-level reuse of a poisoned session.
    session.healthCheckForPool=async()=>{};
    session.resetForPool=async()=>{};
    session.closeNative=async()=>{
      if(index===1)throw fail('DATABASE_ERROR','cleanup failure');
    };
    return session;
  },{maxConnections:1});
  try{
    await assert.rejects(pool.withConnection(lease=>lease.query('SELECT first')),
      error=>error.code==='DATABASE_ERROR');
    assert.equal(pool.stats.discarded,1);
    assert.equal(pool.stats.size,0);
    assert.equal(sessions[0].session.closed,true);
    const returned=await pool.withConnection(lease=>lease.query('SELECT next'));
    assert.deepEqual(returned,result);
    assert.equal(count,2,'replacement is a new physical session');
    assert.equal(pool.stats.created,2);
    assert.equal(pool.stats.idle,1);
  }finally{await pool.close();}
  assert.ok(sessions.every(({socket})=>socket.destroyed));
  assert.equal(pool.stats.size,0);
});

test('implicit cache hits keep the handle and only successful execution promotes it',async()=>{
  const {session}=fixture(2);
  const prepared=[],closed=[],executed=[];
  session.prepareNative=async sql=>{
    prepared.push(sql);
    return {id:prepared.length,parameterCount:1};
  };
  session.closeNative=async id=>{closed.push(id);};
  session.executeNativeResults=async(id,expected,params)=>{
    assert.equal(expected,1);
    executed.push(id);
    if(params[0]===null)throw fail('INVALID_INPUT','fixture rejected bind');
    return [result];
  };
  const a='SELECT ? AS a',b='SELECT ? AS b',c='SELECT ? AS c',d='SELECT ? AS d';
  const oversized='SELECT ? /*'+'é'.repeat(4096)+'*/';
  try{
    await session.query(a,[1]);
    await session.query(b,[1]);
    await assert.rejects(session.query(a,[null]),{code:'INVALID_INPUT'});
    assert.deepEqual(closed,[],'a rejected local bind keeps its handle');
    await session.query(c,[1]);
    assert.deepEqual(closed,[1],'failed execution must not promote the oldest entry');
    await session.queryResults(b,[2]);
    await session.query(d,[1]);
    assert.deepEqual(closed,[1,3],'a successful hit promotes its original handle');
    await session.query(oversized,[1]);
    await session.query(oversized,[2]);
    assert.deepEqual(prepared,[a,b,c,d,oversized,oversized]);
    assert.deepEqual(closed,[1,3,5,6],'oversized keys bypass the cache without eviction');
    assert.deepEqual(executed,[1,2,1,3,2,4,5,6]);
  }finally{await session.close();}
});
