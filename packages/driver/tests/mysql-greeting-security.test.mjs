import {test} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {once} from 'node:events';
import {greeting} from '../dist/vendors/mysql/protocol/handshake.js';
import {F} from '../dist/vendors/mysql/protocol/primitives.js';
import {connectMysql} from '../dist/vendors/mysql/adapter.js';

const join=(...items)=>Buffer.concat(items);
const frame=(payload,sequence)=>join(
  Buffer.from([payload.length&255,(payload.length>>>8)&255,
    (payload.length>>>16)&255,sequence]),payload
);

function greetingBody({
  authLength=21,separator=0,terminator=0,plugin='caching_sha2_password',
  advertisePlugin=true,extra=Buffer.alloc(0)
}={}){
  let capabilities=F.LONG_PASSWORD|F.LONG_FLAG|F.PROTOCOL_41|
    F.TRANSACTIONS|F.SECURE_CONNECTION|F.MULTI_RESULTS|F.PS_MULTI_RESULTS;
  if(advertisePlugin)capabilities|=F.PLUGIN_AUTH;
  const low=Buffer.alloc(2),high=Buffer.alloc(2);
  low.writeUInt16LE(capabilities&0xffff);
  high.writeUInt16LE((capabilities>>>16)&0xffff);
  return join(
    Buffer.from([10]),Buffer.from('8.4.11-test'),Buffer.from([0]),
    Buffer.from([1,0,0,0]),Buffer.alloc(8,0x31),Buffer.from([separator]),
    low,Buffer.from([45,2,0]),high,Buffer.from([authLength]),
    Buffer.alloc(10),Buffer.alloc(12,0x32),Buffer.from([terminator]),
    Buffer.from(plugin),Buffer.from([0]),extra
  );
}

async function peer(sendGreeting,afterLogin){
  const server=net.createServer();
  const clients=new Set();
  let notify;
  const accepted=new Promise(resolve=>{notify=resolve;});
  let received=0;
  server.on('connection',socket=>{
    clients.add(socket);
    socket.on('error',()=>{});
    socket.on('close',()=>clients.delete(socket));
    let queued=Buffer.alloc(0);
    socket.on('data',chunk=>{
      queued=join(queued,chunk);
      while(queued.length>=4){
        const length=queued.readUIntLE(0,3);
        if(queued.length<4+length)break;
        const body=queued.subarray(4,4+length);
        queued=queued.subarray(4+length);
        received++;
        afterLogin?.(socket,body,received);
      }
    });
    socket.write(frame(sendGreeting,0));
    notify(socket);
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  return {
    port:server.address().port,accepted,
    get received(){return received;},
    async close(){
      for(const socket of clients)socket.destroy();
      await new Promise(resolve=>server.close(resolve));
    }
  };
}
const target=(port,password='test-password-never-echo')=>({
  engine:'mysql',host:'127.0.0.1',port,user:'test',password,
  security:'isolated-local',timeoutMs:2000
});

test('legitimate protocol v10 greeting preserves exact 20-byte challenge',()=>{
  const body=greetingBody();
  const result=greeting(body);
  assert.equal(result.version,'8.4.11-test');
  assert.equal(result.plugin,'caching_sha2_password');
  assert.equal(result.seed.length,20);
  assert.deepEqual(result.seed,join(Buffer.alloc(8,0x31),Buffer.alloc(12,0x32)));
});

test('advertised zero or inconsistent greeting auth lengths fail closed',()=>{
  for(const authLength of [0,1,12,20,22,255]){
    assert.throws(
      ()=>greeting(greetingBody({authLength})),
      error=>error.code==='PROTOCOL_ERROR',
      'invalid advertised auth length '+authLength
    );
  }
});

test('greetings reject absent plugin capability, invalid terminators and unexpected bytes',()=>{
  for(const malformed of [
    {advertisePlugin:false},{separator:9},{terminator:0x55},
    {plugin:''},{extra:Buffer.from([9,9])}
  ]){
    assert.throws(()=>greeting(greetingBody(malformed)),
      error=>error.code==='PROTOCOL_ERROR');
  }
  assert.throws(()=>greeting(greetingBody().subarray(0,25)),
    error=>error.code==='PROTOCOL_ERROR');
  assert.throws(()=>greeting(Buffer.alloc(4097,0x61)),
    error=>error.code==='PROTOCOL_ERROR');
});

test('malformed greeting is rejected and transport closed before any login',{timeout:4000},async()=>{
  const server=await peer(greetingBody({authLength:0}));
  try{
    const connection=connectMysql(target(server.port));
    const socket=await server.accepted;
    const disconnected=once(socket,'close');
    await assert.rejects(connection,e=>e.code==='PROTOCOL_ERROR');
    await disconnected;
    assert.equal(server.received,0,'never send credentials to malformed handshake');
    assert.equal(socket.destroyed,true);
  }finally{await server.close();}
});

test('server-controlled authentication error cannot echo secret credentials',{timeout:4000},async()=>{
  const secret='super-private-connection-secret-4e79';
  const errorMessage='Untrusted server chose to echo '+secret;
  const authFailure=join(
    Buffer.from([0xff,0x15,0x04,0x23]),Buffer.from('28000'),Buffer.from(errorMessage)
  );
  const server=await peer(greetingBody(),(socket,_packet,count)=>{
    if(count===1)socket.write(frame(authFailure,2));
  });
  try{
    const connection=connectMysql(target(server.port,secret));
    const socket=await server.accepted;
    const disconnected=once(socket,'close');
    await assert.rejects(connection,error=>{
      assert.equal(error.code,'DATABASE_ERROR');
      assert.equal(error.vendorCode,1045);
      assert.equal(error.sqlState,'28000');
      assert.ok(!error.message.includes(secret),'authentication secret must be redacted');
      assert.ok(!error.message.includes('Untrusted server'),'server error text must not be echoed');
      return true;
    });
    await disconnected;
    assert.equal(server.received,1);
  }finally{await server.close();}
});
