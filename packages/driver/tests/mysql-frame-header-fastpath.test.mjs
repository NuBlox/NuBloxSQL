import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PacketStream} from '../dist/vendors/mysql/protocol/framing.js';

class FakeSocket extends EventEmitter {
  destroyed=false;
  destroy(){
    if(!this.destroyed){
      this.destroyed=true;
      this.emit('close');
    }
  }
}
function frame(body,seq){
  const header=Buffer.from([
    body.length&255,(body.length>>>8)&255,(body.length>>>16)&255,seq
  ]);
  return Buffer.concat([header,body]);
}

test('contiguous and all split header boundaries decode identical packets',{timeout:3000},async()=>{
  const payload=Buffer.from('NuBloxSQL header boundary');
  const message=frame(payload,0);
  for(const split of [0,1,2,3,4,5,6,12,message.length]){
    const socket=new FakeSocket();
    const stream=new PacketStream(socket);
    try{
      const reading=stream.read();
      socket.emit('data',message.subarray(0,split));
      socket.emit('data',message.subarray(split));
      assert.deepEqual(await reading,payload,'split index '+split);
      stream.reset();
    }finally{stream.destroy();}
  }
});

test('incomplete headers resume across multiple data events and parse later frames in place',async()=>{
  const socket=new FakeSocket(),stream=new PacketStream(socket);
  const first=frame(Buffer.from('first'),0);
  const second=frame(Buffer.from('second'),1);
  const third=frame(Buffer.alloc(0),2);
  try{
    socket.emit('data',first.subarray(0,1));
    socket.emit('data',first.subarray(1,3));
    // Complete the first header and body and append a complete second
    // frame plus an incomplete third header in the same data event.
    socket.emit('data',Buffer.concat([
      first.subarray(3),second,third.subarray(0,2)
    ]));
    assert.deepEqual(await stream.read(),Buffer.from('first'));
    assert.deepEqual(await stream.read(),Buffer.from('second'));
    socket.emit('data',third.subarray(2));
    assert.deepEqual(await stream.read(),Buffer.alloc(0));
    stream.reset();
  }finally{stream.destroy();}
});

test('hundreds of contiguous frames in one TCP event retain FIFO ordering and wrapping sequence',async()=>{
  const socket=new FakeSocket(),stream=new PacketStream(socket);
  const messages=Array.from({length:512},(_,i)=>
    frame(Buffer.from([i&255,i>>>8,0xa5]),i&255));
  try{
    socket.emit('data',Buffer.concat(messages));
    for(let i=0;i<messages.length;i++)
      assert.deepEqual(await stream.read(),Buffer.from([i&255,i>>>8,0xa5]));
    stream.reset();
    const fresh=stream.read();
    socket.emit('data',frame(Buffer.from('new exchange'),0));
    assert.deepEqual(await fresh,Buffer.from('new exchange'));
    stream.reset();
  }finally{stream.destroy();}
});

test('sequence mismatch rejects both contiguous and partially assembled headers',async()=>{
  for(const fragment of [false,true]){
    const socket=new FakeSocket(),stream=new PacketStream(socket);
    try{
      const pending=stream.read();
      const malformed=frame(Buffer.from('bad'),8);
      if(fragment){
        socket.emit('data',malformed.subarray(0,3));
        socket.emit('data',malformed.subarray(3));
      }else{
        socket.emit('data',malformed);
      }
      await assert.rejects(pending,e=>e.code==='PROTOCOL_ERROR');
      await assert.rejects(stream.read(),e=>e.code==='PROTOCOL_ERROR');
      assert.throws(()=>stream.reset(),e=>e.code==='PROTOCOL_ERROR');
    }finally{stream.destroy();}
  }
});

test('in-place header fast path retains resource limit on advertised queued packet size',async()=>{
  const socket=new FakeSocket(),stream=new PacketStream(socket);
  const packet=Buffer.from([0xff,0xff,0xff,0]);
  const pending=stream.read();
  try{
    // An advertised maximum-size frame is valid alone, but a second one
    // plus a third continuation of >= 3 bytes exceeds 32 MiB.
    socket.emit('data',packet);
    const bytes=Buffer.alloc(0xffffff);
    socket.emit('data',bytes);
    socket.emit('data',Buffer.from([0xff,0xff,0xff,1]));
    socket.emit('data',bytes);
    socket.emit('data',Buffer.from([3,0,0,2]));
    await assert.rejects(pending,e=>e.code==='RESOURCE_LIMIT');
  }finally{stream.destroy();}
});
