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
  assert.deepEqual(socket.writes.map(x=>x.length),[4,MAX_FRAME_PAYLOAD,13]);
  assert.deepEqual(socket.writes[0],header(MAX_FRAME_PAYLOAD,0));
  assert.deepEqual(socket.writes[2].subarray(0,4),header(9,1));
  assert.deepEqual(Buffer.concat([socket.writes[1],socket.writes[2].subarray(4)]),input);
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
  assert.deepEqual(socket.writes[0],Buffer.concat([header(2,0),Buffer.from('ok')]));
  packets.destroy();
});

test('small outbound commands use exactly one framed socket write, including boundary',async()=>{
  for(const size of [1,2,32,4095,4096]){
    const socket=new CaptureSocket(),packets=new PacketStream(socket);
    const command=Buffer.alloc(size,0x5a);
    await packets.send(command);
    assert.equal(socket.writes.length,1,'size='+size);
    assert.deepEqual(socket.writes[0].subarray(0,4),header(size,0));
    assert.deepEqual(socket.writes[0].subarray(4),command);
    packets.destroy();
  }
});
test('large outbound payloads avoid copying and retain header/payload boundaries',async()=>{
  const socket=new CaptureSocket(),packets=new PacketStream(socket);
  const body=Buffer.alloc(4097,0x2b);
  await packets.send(body);
  assert.equal(socket.writes.length,2);
  assert.deepEqual(socket.writes[0],header(body.length,0));
  assert.equal(socket.writes[1].buffer,body.buffer);
  assert.deepEqual(socket.writes[1],body);
  packets.destroy();
});
test('outbound small messages preserve frame sequence across multiple sends',async()=>{
  const socket=new CaptureSocket(),packets=new PacketStream(socket);
  await packets.send(Buffer.from('a'));
  await packets.send(Buffer.from('b'));
  assert.deepEqual(socket.writes[0],Buffer.concat([header(1,0),Buffer.from('a')]));
  assert.deepEqual(socket.writes[1],Buffer.concat([header(1,1),Buffer.from('b')]));
  packets.destroy();
});
test('single-write socket callback errors reject the outbound message',async()=>{
  class FailingSocket extends CaptureSocket {
    write(data,callback){
      this.writes.push(data);
      callback?.(new Error('transport failed'));
      return false;
    }
  }
  const socket=new FailingSocket(),packets=new PacketStream(socket);
  const errors=[];
  packets.onFatal(error=>errors.push(error));
  const pending=packets.read();
  await assert.rejects(packets.send(Buffer.from('hi')),
    error=>error.code==='CONNECTION_CLOSED'&&!error.message.includes('transport failed'));
  await assert.rejects(pending,error=>error.code==='CONNECTION_CLOSED');
  assert.equal(socket.writes.length,1);
  assert.equal(socket.destroyed,true);
  assert.equal(errors.length,1,'outbound failure revokes the stream exactly once');
  await assert.rejects(packets.send(Buffer.from('no retry')),
    error=>error.code==='CONNECTION_CLOSED');
  assert.throws(()=>packets.reset(),error=>error.code==='CONNECTION_CLOSED');
  assert.equal(socket.writes.length,1,'a poisoned exchange cannot emit more bytes');
  packets.destroy();
});

test('failed large-frame header never transmits its payload',async()=>{
  class HeaderFaultSocket extends CaptureSocket {
    write(data,callback){
      this.writes.push(data);
      callback?.(new Error('sensitive socket exception'));
      return false;
    }
  }
  const socket=new HeaderFaultSocket(),stream=new PacketStream(socket);
  const pending=stream.read();
  await assert.rejects(stream.send(Buffer.alloc(4097,0x27)),
    error=>error.code==='CONNECTION_CLOSED');
  await assert.rejects(pending,error=>error.code==='CONNECTION_CLOSED');
  assert.equal(socket.writes.length,1);
  assert.deepEqual(socket.writes[0],header(4097,0));
  assert.equal(socket.destroyed,true);
  stream.destroy();
});

test('failed large-frame payload prevents later commands and reports one fatal error',async()=>{
  class PayloadFaultSocket extends CaptureSocket {
    write(data,callback){
      this.writes.push(data);
      callback?.(this.writes.length===2?new Error('failed payload'):undefined);
      return true;
    }
  }
  const socket=new PayloadFaultSocket(),stream=new PacketStream(socket);
  const errors=[];
  stream.onFatal(error=>errors.push(error));
  await assert.rejects(stream.send(Buffer.alloc(4097,0x36)),
    error=>error.code==='CONNECTION_CLOSED');
  await assert.rejects(stream.send(Buffer.from('another command')),
    error=>error.code==='CONNECTION_CLOSED');
  assert.deepEqual(socket.writes.map(w=>w.length),[4,4097]);
  assert.equal(socket.destroyed,true);
  assert.equal(errors.length,1);
  stream.destroy();
});

test('a synchronous socket.write exception terminates and redacts the exchange',async()=>{
  class ThrowSocket extends CaptureSocket {
    write(){throw Error('secret transport internals');}
  }
  const socket=new ThrowSocket(),stream=new PacketStream(socket);
  const fatal=[];
  stream.onFatal(e=>fatal.push(e));
  await assert.rejects(stream.send(Buffer.from('command')),
    e=>e.code==='CONNECTION_CLOSED'&&!e.message.includes('secret'));
  assert.equal(fatal.length,1);
  assert.equal(socket.destroyed,true);
  stream.destroy();
});

test('an asynchronously closed socket cannot complete an outbound send successfully',async()=>{
  class ClosingSocket extends CaptureSocket {
    write(data,callback){
      this.writes.push(data);
      this.emit('close');
      callback?.();
      return true;
    }
  }
  const socket=new ClosingSocket(),stream=new PacketStream(socket);
  await assert.rejects(stream.send(Buffer.from('query')),e=>e.message.includes('closed'));
  assert.equal(socket.writes.length,1);
  assert.equal(socket.destroyed,true);
  stream.destroy();
});
