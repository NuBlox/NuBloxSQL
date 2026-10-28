import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {greeting,authSwitchRequest,cachingSha2AuthMore,authenticationOk}
 from '../dist/vendors/mysql/protocol/handshake.js';
import {Cursor,F} from '../dist/vendors/mysql/protocol/primitives.js';
import {field,ok,prepareOk,eofStatus,errorPacket}
 from '../dist/vendors/mysql/protocol/results.js';
import {PacketStream} from '../dist/vendors/mysql/protocol/framing.js';

// Fixed, reviewed corpus and deterministic mutations. No external fuzzing
// dependency, nondeterministic test seed, network or application credentials.
const next=(seed=0x4e425851)=>{
 let x=seed>>>0;
 return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return x>>>0;};
};
const rng=next();
const boundedInt=n=>rng()%n;
const randomBuffer=n=>Buffer.from(Array.from({length:n},()=>boundedInt(256)));
const validGreeting=()=>{
 const mask=F.LONG_PASSWORD|F.LONG_FLAG|F.PROTOCOL_41|
  F.SECURE_CONNECTION|F.PLUGIN_AUTH|F.TRANSACTIONS;
 const capabilities=Buffer.alloc(4);
 capabilities.writeUInt32LE(mask);
 return Buffer.concat([
  Buffer.from([10]),Buffer.from('8.4.13-ci'),Buffer.from([0]),
  Buffer.from([1,0,0,0]),Buffer.alloc(8,0x2f),Buffer.from([0]),
  capabilities.subarray(0,2),Buffer.from([45,2,0]),capabilities.subarray(2),
  Buffer.from([21]),Buffer.alloc(10),Buffer.alloc(12,0x7c),
  Buffer.from([0]),Buffer.from('caching_sha2_password'),Buffer.from([0])
 ]);
};
const asError=fn=>{
 try{return {ok:true,value:fn()};}
 catch(error){assert.ok(error instanceof Error);return {ok:false,error};}
};

test('seeded greeting mutations never escape the bounded protocol-error contract',()=>{
 const good=validGreeting();
 assert.equal(greeting(good).seed.length,20);
 for(let i=0;i<3000;i++){
  const bytes=i%3===0?Buffer.from(good):randomBuffer(boundedInt(128));
  if(i%3===0){
   if(i%9===0)bytes[boundedInt(bytes.length)]^=1<<boundedInt(8);
   else bytes[boundedInt(bytes.length)]=boundedInt(256);
  }
  const result=asError(()=>greeting(bytes));
  if(result.ok){
   assert.equal(result.value.seed.length,20);
   assert.ok(result.value.version.length>0);
   assert.ok(result.value.plugin.length>0);
   assert.ok(Number.isInteger(result.value.id));
  }else{
   assert.equal(result.error.code,'PROTOCOL_ERROR');
  }
 }
 for(const size of [4097,5000,8192]){
  assert.equal(asError(()=>greeting(randomBuffer(size))).error.code,
   'PROTOCOL_ERROR');
 }
});

test('seeded auth switch and OK packets are strictly bounded and typed',()=>{
 const validSwitch=Buffer.concat([
  Buffer.from([0xfe]),Buffer.from('caching_sha2_password'),
  Buffer.from([0]),Buffer.alloc(20,0x35)
 ]);
 assert.equal(authSwitchRequest(validSwitch).seed.length,20);
 for(let i=0;i<2500;i++){
  const bytes=i%2===0?Buffer.from(validSwitch):
   randomBuffer(boundedInt(75));
  if(i%2===0)bytes[boundedInt(bytes.length)]^=1<<boundedInt(8);
  const switched=asError(()=>authSwitchRequest(bytes));
  if(switched.ok){
   assert.equal(switched.value.seed.length,20);
   assert.ok(['mysql_native_password','caching_sha2_password']
    .includes(switched.value.plugin));
  }else{
   assert.ok(['PROTOCOL_ERROR','AUTH_UNSUPPORTED']
    .includes(switched.error.code));
  }
  const auth=asError(()=>cachingSha2AuthMore(bytes));
  if(auth.ok)assert.ok(auth.value===3||auth.value===4);
  else assert.ok(['PROTOCOL_ERROR','AUTH_UNSUPPORTED'].includes(auth.error.code));
  const complete=asError(()=>authenticationOk(bytes));
  if(!complete.ok)assert.equal(complete.error.code,'PROTOCOL_ERROR');
 }
});

test('length-encoded payload mutations cannot read beyond source buffers',()=>{
 for(let i=0;i<4000;i++){
  const payload=randomBuffer(boundedInt(128));
  const cursor=new Cursor(payload);
  const variant=i%5;
  const r=asError(()=>{
   if(variant===0)return cursor.len();
   if(variant===1)return cursor.lbytes();
   if(variant===2)return cursor.lstr();
   if(variant===3)return cursor.zero();
   return cursor.take(boundedInt(256));
  });
  assert.ok(cursor.p>=0&&cursor.p<=payload.length);
  if(r.ok){
   const value=r.value;
   if(variant===0&&value!==null)
    assert.ok(Number.isSafeInteger(value)&&value>=0);
   if(variant===1&&value!==null)assert.ok(Buffer.isBuffer(value));
  }
 }
});

test('prepared, result, EOF and error decoding tolerate corrupt bounded input',()=>{
 const parsers=[field,ok,prepareOk,eofStatus,errorPacket];
 for(let i=0;i<3500;i++){
  const bytes=randomBuffer(boundedInt(145));
  const parser=parsers[i%parsers.length];
  const result=asError(()=>parser(bytes));
  if(result.ok){
   assert.ok(result.value!==null&&typeof result.value==='object');
   if(parser===prepareOk)assert.ok(Number.isInteger(result.value.id));
  }
 }
 for(const n of [0,1,2,3,4,5,11,13]){
  const parsed=asError(()=>prepareOk(Buffer.alloc(n)));
  assert.equal(parsed.error.code,'PROTOCOL_ERROR');
 }
});

class MockSocket extends EventEmitter {
 destroyed=false;
 write(_bytes,callback){callback?.();return true;}
 destroy(){this.destroyed=true;this.emit('close');}
}

test('fragmented valid Classic frames reconstruct original bytes for seeded chunk cuts',async()=>{
 for(let iteration=0;iteration<350;iteration++){
  const payload=randomBuffer(boundedInt(256));
  const header=Buffer.alloc(4);
  header.writeUIntLE(payload.length,0,3);
  const framed=Buffer.concat([header,payload]);
  const socket=new MockSocket();
  const stream=new PacketStream(socket);
  let index=0;
  while(index<framed.length){
   const end=Math.min(framed.length,index+1+boundedInt(17));
   socket.emit('data',framed.subarray(index,end));
   index=end;
  }
  assert.deepEqual(await stream.read(),payload);
  stream.destroy();
 }
});

test('bad Classic frame sequence fails closed before a queued read can succeed',async()=>{
 for(let i=0;i<250;i++){
  const socket=new MockSocket();
  const stream=new PacketStream(socket);
  const length=boundedInt(128);
  const header=Buffer.alloc(4);
  header.writeUIntLE(length,0,3);
  header[3]=1+boundedInt(255);
  socket.emit('data',header);
  await assert.rejects(stream.read(),e=>e.code==='PROTOCOL_ERROR');
  stream.destroy();
 }
});
