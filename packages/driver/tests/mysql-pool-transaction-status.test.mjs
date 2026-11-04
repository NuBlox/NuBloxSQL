import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PacketStream} from '../dist/vendors/mysql/protocol/framing.js';
import {MysqlSession} from '../dist/vendors/mysql/adapter.js';
import {ConnectionPool} from '../dist/core/pooling.js';

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

function fixture(statuses){
  const socket=new FixtureSocket();
  const stream=new PacketStream(socket);
  const session=new MysqlSession(stream,socket,{
    engine:'mysql',host:'127.0.0.1',port:3306,user:'fixture',
    password:'',security:'isolated-local',timeoutMs:2000
  },{
    version:'8.4-fixture',plugin:'caching_sha2_password',
    seed:Buffer.alloc(20),id:1,flags:0
  });
  const commands=[];
  stream.send=async packet=>{commands.push(Buffer.from(packet));};
  stream.read=async()=>{
    if(statuses.length===0)throw Error('No fixture response');
    const status=statuses.shift();
    // Protocol 4.1 OK: affected rows, insert id, status and warnings.
    return Buffer.from([0,0,0,status&255,(status>>8)&255,0,0]);
  };
  return {session,socket,commands};
}

test('pool health and reset accept an acknowledged session without IN_TRANS',async()=>{
  for(const status of [0,2]){
    for(const [method,command] of [['healthCheckForPool',0x0e],['resetForPool',0x1f]]){
      const {session,socket,commands}=fixture([status]);
      try{
        if(method==='healthCheckForPool')await session.healthCheckForPool(1000);
        else await session.resetForPool();
        assert.equal(session.closed,false);
        assert.equal(socket.destroyed,false);
        assert.deepEqual(commands,[Buffer.from([command])]);
      }finally{await session.close();}
    }
  }
});

test('pool health and reset reject active-transaction OK and revoke the socket',async()=>{
  for(const status of [1,3]){
    for(const [method,command] of [['healthCheckForPool',0x0e],['resetForPool',0x1f]]){
      const {session,socket,commands}=fixture([status]);
      await assert.rejects(
        method==='healthCheckForPool'
          ?session.healthCheckForPool(1000)
          :session.resetForPool(),
        error=>error.code==='PROTOCOL_ERROR'&&
          /did not confirm an inactive transaction/.test(error.message)
      );
      assert.deepEqual(commands,[Buffer.from([command])]);
      assert.equal(session.closed,true);
      assert.equal(socket.destroyed,true);
      await assert.rejects(session.query('SELECT 1'),
        error=>error.code==='CONNECTION_CLOSED');
    }
  }
});

test('checkout discards a transaction-active health response and only lends a fresh session',async()=>{
  const created=[];
  const pool=new ConnectionPool(async()=>{
    const item=fixture(created.length===0?[3]:[2,2]);
    created.push(item);
    return item.session;
  },{maxConnections:1});
  try{
    assert.equal(await pool.withConnection(async lease=>lease.info.engine),'mysql');
    assert.equal(created.length,2);
    assert.equal(created[0].socket.destroyed,true);
    assert.equal(created[1].socket.destroyed,false);
    assert.equal(pool.stats.healthFailures,1);
    assert.equal(pool.stats.discarded,1);
    assert.deepEqual(created[0].commands,[Buffer.from([0x0e])]);
    assert.deepEqual(created[1].commands,[Buffer.from([0x0e]),Buffer.from([0x1f])]);
  }finally{await pool.close();}
});

test('reset reporting an active transaction rejects release and forces replacement',async()=>{
  const created=[];
  const pool=new ConnectionPool(async()=>{
    const item=fixture(created.length===0?[2,3]:[2,2]);
    created.push(item);
    return item.session;
  },{maxConnections:1});
  try{
    await assert.rejects(pool.withConnection(async()=>42),
      error=>error.code==='CONNECTION_FAILED'&&/reset failed/.test(error.message));
    assert.equal(created[0].socket.destroyed,true);
    assert.deepEqual(created[0].commands,[Buffer.from([0x0e]),Buffer.from([0x1f])]);
    assert.equal(await pool.withConnection(async()=>43),43);
    assert.equal(created.length,2);
    assert.equal(pool.stats.discarded,1);
  }finally{await pool.close();}
});
