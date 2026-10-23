import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {PacketStream,MAX_FRAME_PAYLOAD} from '../dist/vendors/mysql/protocol/framing.js';
import {LIMIT} from '../dist/vendors/mysql/protocol/primitives.js';
import {ConnectionPool} from '../dist/core/pooling.js';

const frame=(n,seq)=>Buffer.from([n&255,(n>>8)&255,(n>>16)&255,seq]);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const brokenSession=id=>({
 id,closed:false,
 info:{engine:'mysql',model:'relational',version:'test',capabilities:[]},
 async healthCheckForPool(){if(this.closed)throw Error('unhealthy');},
 async resetForPool(){if(this.closed)throw Error('closed');},
 async query(){if(this.closed)throw Error('closed');return {rows:[{id}],columns:[],affectedRows:0,insertId:0};},
 async close(){this.closed=true;}
});

test('aggregate queued incoming bytes fail closed across multiple legal messages',async()=>{
 const socket=new PassThrough(),stream=new PacketStream(socket);
 let fatal;
 stream.onFatal(e=>{fatal=e;});
 const payload=Buffer.alloc(1024*1024,0x78);
 for(let i=0;i<=32;i++){
   if(fatal)break;
   socket.write(frame(payload.length,i));
   socket.write(payload);
 }
 assert.equal(fatal?.code,'RESOURCE_LIMIT');
 assert.equal(stream.queuedBytes,0);
 await assert.rejects(stream.read(),e=>e.code==='RESOURCE_LIMIT');
 await assert.rejects(stream.send(Buffer.from('no replay')),e=>e.code==='RESOURCE_LIMIT');
 stream.destroy();
});

test('truncated logical message and missing exact-boundary trailer are terminal on EOF',async()=>{
 for(const kind of ['partial-header','partial-payload','missing-trailer']){
  const socket=new PassThrough(),stream=new PacketStream(socket);
  const reading=stream.read();
  if(kind==='partial-header')socket.write(Buffer.from([1,0]));
  if(kind==='partial-payload'){
    socket.write(frame(12,0));
    socket.write(Buffer.alloc(3));
  }
  if(kind==='missing-trailer'){
    socket.write(frame(MAX_FRAME_PAYLOAD,0));
    socket.write(Buffer.alloc(MAX_FRAME_PAYLOAD));
  }
  socket.destroy();
  await assert.rejects(reading,/closed/);
  assert.throws(()=>stream.reset(),/closed/);
  stream.destroy();
 }
});

test('truncated continuation header is rejected, not mistaken for an independent result',async()=>{
 const socket=new PassThrough(),stream=new PacketStream(socket);
 const reading=stream.read();
 socket.write(frame(MAX_FRAME_PAYLOAD,0));
 socket.write(Buffer.alloc(MAX_FRAME_PAYLOAD));
 socket.write(Buffer.from([1,0]));
 socket.destroy();
 await assert.rejects(reading,/closed/);
 stream.destroy();
});

test('over-limit fragmented payload closes the packet stream without retaining buffers',async()=>{
 const socket=new PassThrough(),stream=new PacketStream(socket);
 const reading=stream.read();
 socket.write(frame(MAX_FRAME_PAYLOAD,0));
 socket.write(Buffer.alloc(MAX_FRAME_PAYLOAD));
 socket.write(frame(MAX_FRAME_PAYLOAD,1));
 socket.write(Buffer.alloc(MAX_FRAME_PAYLOAD));
 socket.write(frame(10,2));
 socket.write(Buffer.alloc(10));
 await assert.rejects(reading,e=>e.code==='RESOURCE_LIMIT');
 assert.equal(stream.logicalBytes,0);
 assert.equal(stream.fragments.length,0);
 assert.equal(stream.queue.length,0);
 stream.destroy();
});

test('bursty pool failure discard cannot exceed capacity or replay work',async()=>{
 let created=0,applications=0;
 const sessions=[];
 const pool=new ConnectionPool(async()=>{
   const item=brokenSession(++created);
   sessions.push(item);
   return item;
 },{maxConnections:3,acquireTimeoutMs:3000});
 try{
  const failures=Array.from({length:36},(_,i)=>pool.withConnection(async lease=>{
    applications++;
    const result=await lease.query('SELECT id');
    assert.ok(result.rows[0].id>=1);
    if(i%4===0)throw Error('deliberately failed callback');
    return result.rows[0].id;
  }).then(()=> 'ok',e=>e.message==='deliberately failed callback'?'expected':'unexpected'));
  const settled=await Promise.all(failures);
  assert.equal(settled.filter(x=>x==='expected').length,9);
  assert.equal(settled.filter(x=>x==='unexpected').length,0);
  assert.equal(applications,36,'pool must not retry any callback');
  assert.ok(pool.stats.size<=3);
  assert.equal(pool.stats.pending,0);
  assert.ok(pool.stats.discarded>=9);
 }finally{await pool.close();}
 assert.equal(pool.stats.size,0);
 assert.ok(sessions.every(s=>s.closed));
});
