import {test} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {once} from 'node:events';
import {connectMysql} from '../dist/vendors/mysql/adapter.js';
import {ConnectionPool} from '../dist/core/pooling.js';

async function silentServer(){
  const server=net.createServer();
  const clients=new Set();
  server.on('connection',socket=>{
    clients.add(socket);
    socket.on('close',()=>clients.delete(socket));
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const port=server.address().port;
  return {
    server,clients,port,
    close:async()=>{
      for(const socket of clients)socket.destroy();
      await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    }
  };
}
const target=port=>({
  engine:'mysql',host:'127.0.0.1',port,
  user:'test',password:'unused',security:'isolated-local',timeoutMs:5000
});

test('aborting a stalled greeting closes the native TCP socket',{timeout:4000},async()=>{
  const server=await silentServer();
  try{
    const controller=new AbortController();
    const accepted=once(server.server,'connection');
    const connection=connectMysql(target(server.port),controller.signal);
    const [socket]=await accepted;
    const disconnected=once(socket,'close');
    controller.abort();
    await assert.rejects(connection,error=>error.code==='CANCELLED');
    await disconnected;
    assert.equal(socket.destroyed,true);
  }finally{await server.close();}
});

test('pool timeout aborts stalled native connection and releases capacity',{timeout:4000},async()=>{
  const server=await silentServer();
  const pool=new ConnectionPool(signal=>connectMysql(target(server.port),signal),{
    maxConnections:1,acquireTimeoutMs:150
  });
  try{
    let invoked=false;
    const request=pool.withConnection(async()=>{invoked=true;});
    const [socket]=await once(server.server,'connection');
    const disconnected=once(socket,'close');
    await assert.rejects(request,error=>error.code==='TIMEOUT');
    await disconnected;
    // The native abort completes asynchronously after rejecting the borrower.
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(invoked,false);
    assert.equal(socket.destroyed,true);
    assert.equal(pool.stats.connecting,0);
    assert.equal(pool.stats.size,0);
    assert.equal(pool.stats.acquireTimeouts,1);
  }finally{
    await pool.close();
    await server.close();
  }
});

test('pool shutdown aborts stalled native handshake immediately',{timeout:4000},async()=>{
  const server=await silentServer();
  const pool=new ConnectionPool(signal=>connectMysql(target(server.port),signal),{
    maxConnections:1,acquireTimeoutMs:2500
  });
  try{
    const request=pool.withConnection(async()=>{
      throw Error('application work must not run');
    });
    const [socket]=await once(server.server,'connection');
    const disconnected=once(socket,'close');
    await pool.close();
    await assert.rejects(request,error=>error.code==='CONNECTION_CLOSED');
    await disconnected;
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(pool.stats.connecting,0);
    assert.equal(pool.stats.size,0);
  }finally{
    await pool.close();
    await server.close();
  }
});
