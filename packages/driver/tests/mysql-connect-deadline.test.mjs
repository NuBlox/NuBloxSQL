import {test} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {once} from 'node:events';
import {connectMysql} from '../dist/vendors/mysql/adapter.js';
import {F} from '../dist/vendors/mysql/protocol/primitives.js';

const target=(port,security='isolated-local')=>({
  engine:'mysql',host:'127.0.0.1',port,user:'test',password:'not-secret',
  security,serverName:security==='verified-tls'?'localhost':undefined,
  timeoutMs:250
});

async function serverWith(onConnection=()=>{}){
  let notify;
  const accepted=new Promise(resolve=>{notify=resolve;});
  const sockets=new Set();
  const server=net.createServer(socket=>{
    sockets.add(socket);
    socket.on('close',()=>sockets.delete(socket));
    socket.on('error',()=>{});
    onConnection(socket);
    notify(socket);
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  return {
    port:server.address().port,accepted,
    async close(){
      for(const socket of sockets)socket.destroy();
      await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    }
  };
}

// A legitimate MySQL 8.4 Classic handshake advertising both plaintext and
// SSLRequest authentication paths. The fake server deliberately never
// completes the selected path, allowing deadline behaviour to be verified.
function greetingPacket(){
  const capabilities=F.LONG_PASSWORD|F.LONG_FLAG|F.PROTOCOL_41|
    F.TRANSACTIONS|F.SECURE_CONNECTION|F.PLUGIN_AUTH|F.MULTI_RESULTS|
    F.PS_MULTI_RESULTS|F.SSL;
  const low=Buffer.alloc(2),high=Buffer.alloc(2);
  low.writeUInt16LE(capabilities&0xffff);
  high.writeUInt16LE((capabilities>>>16)&0xffff);
  const body=Buffer.concat([
    Buffer.from([10]),Buffer.from('8.4.11-test','utf8'),Buffer.from([0]),
    Buffer.from([1,0,0,0]),Buffer.alloc(8,0x31),Buffer.from([0]),
    low,Buffer.from([45,2,0]),high,Buffer.from([21]),
    Buffer.alloc(10),Buffer.alloc(12,0x32),Buffer.from([0]),
    Buffer.from('caching_sha2_password','utf8'),Buffer.from([0])
  ]);
  return Buffer.concat([
    Buffer.from([body.length&255,(body.length>>>8)&255,(body.length>>>16)&255,0]),body
  ]);
}

test('silent MySQL greeting times out with TIMEOUT and closes TCP',{timeout:4000},async()=>{
  const server=await serverWith();
  try{
    const connection=connectMysql(target(server.port));
    const socket=await server.accepted;
    const closed=once(socket,'close');
    await assert.rejects(connection,error=>error.code==='TIMEOUT');
    await closed;
    assert.equal(socket.destroyed,true);
  }finally{await server.close();}
});

test('MySQL authentication stall preserves TIMEOUT instead of CONNECTION_FAILED',{timeout:4000},async()=>{
  let received=0;
  const server=await serverWith(socket=>{
    socket.on('data',chunk=>{received+=chunk.length;});
    socket.write(greetingPacket());
  });
  try{
    const connection=connectMysql(target(server.port));
    const socket=await server.accepted;
    const closed=once(socket,'close');
    await assert.rejects(connection,error=>error.code==='TIMEOUT');
    await closed;
    assert.ok(received>4,'the client must send a login frame before stalling');
    assert.equal(socket.destroyed,true);
  }finally{await server.close();}
});

test('stalled MySQL STARTTLS handshake times out and destroys the TLS transport',{timeout:4000},async()=>{
  let received=Buffer.alloc(0);
  const server=await serverWith(socket=>{
    socket.on('data',chunk=>{received=Buffer.concat([received,chunk]);});
    socket.write(greetingPacket());
  });
  try{
    const connection=connectMysql(target(server.port,'verified-tls'));
    const socket=await server.accepted;
    const closed=once(socket,'close');
    await assert.rejects(connection,error=>error.code==='TIMEOUT');
    await closed;
    assert.ok(received.length>=36,'client must attempt an SSLRequest');
    assert.equal(received.readUIntLE(0,3),32,'SSLRequest must be 32 bytes');
    assert.equal(received[3],1,'SSLRequest follows greeting sequence zero');
    assert.equal(socket.destroyed,true);
  }finally{await server.close();}
});

test('abort wins over a later MySQL STARTTLS deadline',{timeout:4000},async()=>{
  const server=await serverWith(socket=>socket.write(greetingPacket()));
  try{
    const controller=new AbortController();
    const connection=connectMysql(target(server.port,'verified-tls'),controller.signal);
    const socket=await server.accepted;
    const closed=once(socket,'close');
    controller.abort();
    await assert.rejects(connection,error=>error.code==='CANCELLED');
    await closed;
    assert.equal(socket.destroyed,true);
  }finally{await server.close();}
});
