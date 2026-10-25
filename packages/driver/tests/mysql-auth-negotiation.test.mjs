import {test} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {once} from 'node:events';
import {authSwitchRequest,cachingSha2AuthMore} from '../dist/vendors/mysql/protocol/handshake.js';
import {assertSupportedAuthPlugin,token} from '../dist/vendors/mysql/auth/plugins.js';
import {connectMysql} from '../dist/vendors/mysql/adapter.js';
import {F} from '../dist/vendors/mysql/protocol/primitives.js';

const bytes=(...items)=>Buffer.concat(items);
const frame=(body,sequence)=>bytes(
  Buffer.from([body.length&255,(body.length>>>8)&255,(body.length>>>16)&255,sequence]),
  body
);
const pluginBytes=name=>bytes(Buffer.from(name,'ascii'),Buffer.from([0]));
const switchPacket=(name,seed)=>bytes(Buffer.from([0xfe]),pluginBytes(name),seed);

function greetingPacket(plugin='caching_sha2_password'){
  const caps=F.LONG_PASSWORD|F.LONG_FLAG|F.PROTOCOL_41|
    F.TRANSACTIONS|F.SECURE_CONNECTION|F.PLUGIN_AUTH|F.MULTI_RESULTS|
    F.PS_MULTI_RESULTS;
  const low=Buffer.alloc(2),high=Buffer.alloc(2);
  low.writeUInt16LE(caps&0xffff);
  high.writeUInt16LE((caps>>>16)&0xffff);
  const message=bytes(
    Buffer.from([10]),pluginBytes('8.4.11-test'),Buffer.from([1,0,0,0]),
    Buffer.alloc(8,0x31),Buffer.from([0]),low,
    Buffer.from([45,2,0]),high,Buffer.from([21]),Buffer.alloc(10),
    Buffer.alloc(12,0x32),Buffer.from([0]),pluginBytes(plugin)
  );
  return frame(message,0);
}

async function startPeer(plugin,respond){
  const server=net.createServer();
  const sockets=new Set();
  let receivedFrames=0;
  let accepted;
  const established=new Promise(resolve=>{accepted=resolve;});
  server.on('connection',socket=>{
    sockets.add(socket);
    socket.on('error',()=>{});
    socket.on('close',()=>sockets.delete(socket));
    let backlog=Buffer.alloc(0);
    socket.on('data',chunk=>{
      backlog=bytes(backlog,chunk);
      while(backlog.length>=4){
        const length=backlog.readUIntLE(0,3);
        if(backlog.length<length+4)break;
        const packet=backlog.subarray(4,length+4);
        const seq=backlog[3];
        backlog=backlog.subarray(length+4);
        receivedFrames++;
        respond?.(socket,packet,seq,receivedFrames);
      }
    });
    socket.write(greetingPacket(plugin));
    accepted(socket);
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  return {
    port:server.address().port,
    established,
    get receivedFrames(){return receivedFrames;},
    async close(){
      for(const socket of sockets)socket.destroy();
      await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    }
  };
}
const target=(port,password='private-test-password')=>({
  engine:'mysql',host:'127.0.0.1',port,user:'test',
  password,security:'isolated-local',timeoutMs:2000
});

test('authentication tokens reject unknown plugins even without a password',()=>{
  assert.throws(()=>assertSupportedAuthPlugin('unsupported'),error=>error.code==='AUTH_UNSUPPORTED');
  assert.throws(()=>token('',Buffer.alloc(20),'unsupported'),error=>error.code==='AUTH_UNSUPPORTED');
  assert.equal(token('',Buffer.alloc(20),'caching_sha2_password').length,0);
});

test('authentication switch retains a 20-byte challenge ending in zero',()=>{
  const seed=Buffer.alloc(20,0x66);
  seed[19]=0;
  const withoutTerminator=authSwitchRequest(switchPacket('caching_sha2_password',seed));
  const withTerminator=authSwitchRequest(switchPacket(
    'mysql_native_password',bytes(seed,Buffer.from([0]))
  ));
  assert.deepEqual(withoutTerminator.seed,seed);
  assert.deepEqual(withTerminator.seed,seed);
  assert.equal(withoutTerminator.plugin,'caching_sha2_password');
  assert.equal(withTerminator.plugin,'mysql_native_password');
});

test('malformed or unsupported switch requests fail before generating tokens',()=>{
  const seed=Buffer.alloc(20,0x42);
  for(const challenge of [
    Buffer.alloc(0),Buffer.alloc(19,0x42),
    bytes(seed,Buffer.from([1])),bytes(seed,Buffer.from([0,0]))
  ]){
    assert.throws(
      ()=>authSwitchRequest(switchPacket('caching_sha2_password',challenge)),
      error=>error.code==='PROTOCOL_ERROR'
    );
  }
  assert.throws(
    ()=>authSwitchRequest(switchPacket('untrusted_plugin',seed)),
    error=>error.code==='AUTH_UNSUPPORTED'
  );
  assert.throws(
    ()=>authSwitchRequest(bytes(Buffer.from([0xfe]),Buffer.from('caching_sha2_password'))),
    error=>error.code==='PROTOCOL_ERROR'
  );
});

test('SHA-2 authentication continuation accepts only exact status packets',()=>{
  assert.equal(cachingSha2AuthMore(Buffer.from([1,3])),3);
  assert.equal(cachingSha2AuthMore(Buffer.from([1,4])),4);
  for(const packet of [
    Buffer.from([1]),Buffer.from([1,3,0]),Buffer.from([1,4,0]),
    Buffer.from([0,4])
  ]){
    assert.throws(()=>cachingSha2AuthMore(packet),e=>e.code==='PROTOCOL_ERROR');
  }
  assert.throws(()=>cachingSha2AuthMore(Buffer.from([1,99])),e=>e.code==='AUTH_UNSUPPORTED');
});

test('unsupported greeting plugin does not emit a login even with empty password',{timeout:4000},async()=>{
  const peer=await startPeer('untrusted_plugin');
  try{
    const connection=connectMysql(target(peer.port,''));
    const socket=await peer.established;
    const closed=once(socket,'close');
    await assert.rejects(connection,error=>error.code==='AUTH_UNSUPPORTED');
    await closed;
    assert.equal(peer.receivedFrames,0,'must not send login before checking auth plugin');
  }finally{await peer.close();}
});

test('malformed auth switch terminates connection without emitting another token',{timeout:4000},async()=>{
  const peer=await startPeer('caching_sha2_password',(socket,packet,seq,count)=>{
    if(count===1){
      assert.equal(seq,1,'client login follows server greeting');
      socket.write(frame(switchPacket('caching_sha2_password',Buffer.alloc(6,0x55)),2));
    }
  });
  try{
    const connection=connectMysql(target(peer.port));
    const socket=await peer.established;
    const closed=once(socket,'close');
    await assert.rejects(connection,error=>error.code==='PROTOCOL_ERROR');
    await closed;
    assert.equal(peer.receivedFrames,1,'must not send an authentication token after malformed switch');
  }finally{await peer.close();}
});

test('supported auth switch exchanges one token and establishes a native session',{timeout:4000},async()=>{
  const challenge=Buffer.alloc(20,0x52);
  let challengeResponse;
  const peer=await startPeer('caching_sha2_password',(socket,packet,seq,count)=>{
    if(count===1){
      assert.equal(seq,1);
      socket.write(frame(switchPacket('mysql_native_password',
        bytes(challenge,Buffer.from([0]))),2));
    }else if(count===2){
      assert.equal(seq,3);
      challengeResponse=Buffer.from(packet);
      socket.write(frame(Buffer.from([0,0,0,2,0,0,0]),4));
    }
  });
  let session;
  try{
    session=await connectMysql(target(peer.port));
    assert.equal(session.info.authPlugin,'mysql_native_password');
    assert.deepEqual(challengeResponse,token('private-test-password',challenge,'mysql_native_password'));
    assert.equal(peer.receivedFrames,2);
  }finally{
    await session?.close();
    await peer.close();
  }
});
