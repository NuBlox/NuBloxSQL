import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {PacketStream,MAX_FRAME_PAYLOAD} from '../dist/vendors/mysql/protocol/framing.js';
import {LIMIT} from '../dist/vendors/mysql/protocol/primitives.js';

const header=(length,sequence)=>Buffer.from([
  length&255,(length>>>8)&255,(length>>>16)&255,sequence
]);
function incoming(socket,length,seq,fill=123){
  socket.write(header(length,seq));
  if(length)socket.write(Buffer.alloc(length,fill));
}
class CaptureSocket extends EventEmitter {
  writes=[];
  destroyed=false;
  write(data,callback){
    this.writes.push(data);
    callback?.();
    return true;
  }
  destroy(){this.destroyed=true;}
}
test('outbound Classic messages split at 0xffffff with per-frame sequence numbers',async()=>{
  const socket=new CaptureSocket(),packets=new PacketStream(socket);
  const input=Buffer.alloc(MAX_FRAME_PAYLOAD+9,0xa5);
  await packets.send(input);
  assert.deepEqual(socket.writes.map(x=>x.length),[4,MAX_FRAME_PAYLOAD,4,9]);
  assert.deepEqual(socket.writes[0],header(MAX_FRAME_PAYLOAD,0));
  assert.deepEqual(socket.writes[2],header(9,1));
  assert.deepEqual(Buffer.concat([socket.writes[1],socket.writes[3]]),input);
  packets.destroy();
});
test('exact 0xffffff outbound payload requires a terminating zero-length frame',async()=>{
  const socket=new CaptureSocket(),packets=new PacketStream(socket);
  await packets.send(Buffer.alloc(MAX_FRAME_PAYLOAD,0x21));
  assert.deepEqual(socket.writes.map(x=>x.length),[4,MAX_FRAME_PAYLOAD,4]);
  assert.deepEqual(socket.writes[0],header(MAX_FRAME_PAYLOAD,0));
  assert.deepEqual(socket.writes[2],header(0,1));
  packets.destroy();
});
test('zero-length logical MySQL messages still have a 4-byte frame header',async()=>{
  const socket=new CaptureSocket(),packets=new PacketStream(socket);
  await packets.send(Buffer.alloc(0));
  assert.deepEqual(socket.writes,[header(0,0)]);
  packets.destroy();
});
test('inbound empty message completes when the header ends exactly at a chunk boundary',{timeout:2000},async()=>{
  const socket=new PassThrough(),packets=new PacketStream(socket);
  const pending=packets.read();
  socket.write(header(0,0));
  assert.deepEqual(await pending,Buffer.alloc(0));
  packets.reset();
  packets.destroy();
});
test('inbound empty message completes when the header arrives in separate chunks',{timeout:2000},async()=>{
  const socket=new PassThrough(),packets=new PacketStream(socket);
  const pending=packets.read();
  const h=header(0,0);
  socket.write(h.subarray(0,2));
  socket.write(h.subarray(2));
  assert.deepEqual(await pending,Buffer.alloc(0));
  packets.reset();
  packets.destroy();
});
test('inbound reassembly supports 24-bit maximum frame plus follow-on frame',async()=>{
  const socket=new PassThrough(),packets=new PacketStream(socket);
  const pending=packets.read();
  const data=Buffer.alloc(MAX_FRAME_PAYLOAD,0x61);
  socket.write(header(data.length,0));
  for(let i=0;i<data.length;i+=65537)socket.write(data.subarray(i,i+65537));
  socket.write(header(7,1));
  socket.write(Buffer.from('nublox!', 'ascii'));
  const logical=await pending;
  assert.equal(logical.length,MAX_FRAME_PAYLOAD+7);
  assert.equal(logical[0],0x61);
  assert.equal(logical[MAX_FRAME_PAYLOAD-1],0x61);
  assert.equal(logical.subarray(-7).toString(),'nublox!');
  packets.reset();
  packets.destroy();
});
test('inbound exact-multiple message requires an empty final frame before read settles',async()=>{
  const socket=new PassThrough(),packets=new PacketStream(socket);
  let settled=false;
  const result=packets.read().then(b=>{settled=true;return b;});
  incoming(socket,MAX_FRAME_PAYLOAD,0,0x34);
  await Promise.resolve();
  assert.equal(settled,false,'maximum-size frame is not a complete logical packet');
  socket.write(header(0,1));
  const logical=await result;
  assert.equal(logical.length,MAX_FRAME_PAYLOAD);
  assert.equal(logical[0],0x34);
  packets.reset();
  packets.destroy();
});
test('a wrong continuation sequence fails closed even when first frame is valid',async()=>{
  const socket=new PassThrough(),packets=new PacketStream(socket);
  const pending=packets.read();
  incoming(socket,MAX_FRAME_PAYLOAD,0,0x31);
  socket.write(header(1,3));
  await assert.rejects(pending,error=>error.code==='PROTOCOL_ERROR');
  await assert.rejects(packets.read(),error=>error.code==='PROTOCOL_ERROR');
  packets.destroy();
});
test('a partial fragmented message prevents resetting the command sequence',async()=>{
  const socket=new PassThrough(),packets=new PacketStream(socket);
  incoming(socket,MAX_FRAME_PAYLOAD,0,0x61);
  assert.throws(()=>packets.reset(),/unread/);
  socket.write(header(1,1));
  socket.write(Buffer.from('x'));
  const b=await packets.read();
  assert.equal(b.length,MAX_FRAME_PAYLOAD+1);
  packets.reset();
  packets.destroy();
});
test('oversized continuation fails at its header even if peer withholds payload',{timeout:3000},async()=>{
  const socket=new PassThrough(),packets=new PacketStream(socket);
  const waiting=packets.read();
  const frame=Buffer.alloc(MAX_FRAME_PAYLOAD,0x42);
  socket.write(header(MAX_FRAME_PAYLOAD,0));
  socket.write(frame);
  socket.write(header(MAX_FRAME_PAYLOAD,1));
  socket.write(frame);
  // Two maximum frames total LIMIT - 2 bytes. A third frame advertising
  // three bytes is impossible within the logical packet safety limit.
  socket.write(header(3,2));
  await assert.rejects(waiting,error=>error.code==='RESOURCE_LIMIT');
  await assert.rejects(packets.read(),error=>error.code==='RESOURCE_LIMIT');
  assert.throws(()=>packets.reset(),error=>error.code==='RESOURCE_LIMIT');
  packets.destroy();
});

test('exact inbound 32 MiB logical message remains valid across three frames',{timeout:4000},async()=>{
  const socket=new PassThrough(),packets=new PacketStream(socket);
  const waiting=packets.read();
  const frame=Buffer.alloc(MAX_FRAME_PAYLOAD,0x5a);
  socket.write(header(MAX_FRAME_PAYLOAD,0));
  socket.write(frame);
  socket.write(header(MAX_FRAME_PAYLOAD,1));
  socket.write(frame);
  socket.write(header(2,2));
  socket.write(Buffer.from([0x42,0x43]));
  const result=await waiting;
  assert.equal(result.length,LIMIT);
  assert.equal(result[0],0x5a);
  assert.equal(result[MAX_FRAME_PAYLOAD],0x5a);
  assert.deepEqual(result.subarray(-2),Buffer.from([0x42,0x43]));
  packets.reset();
  packets.destroy();
});

test('zero-byte packet flood is bounded even though queued byte count stays zero',async()=>{
  const socket=new PassThrough(),packets=new PacketStream(socket);
  const failure=[];
  packets.onFatal(error=>failure.push(error));
  for(let i=0;i<1025;i++)socket.write(header(0,i&255));
  assert.equal(failure.length,1);
  assert.equal(failure[0].code,'RESOURCE_LIMIT');
  await assert.rejects(packets.read(),error=>error.code==='RESOURCE_LIMIT');
  packets.destroy();
});

test('outbound logical packet above the bounded cap is rejected without writing',async()=>{
  const socket=new CaptureSocket(),packets=new PacketStream(socket);
  await assert.rejects(packets.send(Buffer.alloc(LIMIT+1)),/outbound logical packet.*limit/);
  assert.equal(socket.writes.length,0);
  await packets.send(Buffer.from('ok'));
  assert.deepEqual(socket.writes[0],header(2,0));
  packets.destroy();
});
