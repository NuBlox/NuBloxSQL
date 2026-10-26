import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PacketStream} from '../dist/vendors/mysql/protocol/framing.js';
import {MysqlSession} from '../dist/vendors/mysql/adapter.js';

const okPacket=Buffer.from([7,0,0,1,0,0,0,2,0,0,0]);

class PingSocket extends EventEmitter {
  destroyed=false;
  commands=0;
  holdFirst=false;
  firstWaiting=false;
  constructor({holdFirst=false}={}){
    super();
    this.holdFirst=holdFirst;
  }
  write(data,callback){
    assert.equal(this.destroyed,false,'a closed transport may not write');
    assert.deepEqual(data,Buffer.from([1,0,0,0,0x0e]),
      'each COM_PING must be one complete framed write with reset sequence');
    this.commands++;
    if(this.commands===1&&this.holdFirst)this.firstWaiting=true;
    else queueMicrotask(()=>{if(!this.destroyed)this.emit('data',okPacket);});
    callback?.();
    return true;
  }
  release(){
    assert.equal(this.firstWaiting,true,'first ping must be pending');
    this.firstWaiting=false;
    queueMicrotask(()=>{if(!this.destroyed)this.emit('data',okPacket);});
  }
  destroy(){
    if(this.destroyed)return this;
    this.destroyed=true;
    this.emit('close');
    return this;
  }
}
function open(options){
  const socket=new PingSocket(options);
  const stream=new PacketStream(socket);
  const session=new MysqlSession(stream,socket,{
    engine:'mysql',host:'127.0.0.1',port:3306,user:'fixture',
    password:'',database:'',security:'isolated-local',timeoutMs:5000
  },{
    version:'8.4.11-fixture',plugin:'caching_sha2_password',
    seed:Buffer.alloc(20),id:1,flags:0
  });
  return {socket,session};
}
const microtasks=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};

test('uncontended commands retain exactly-once delivery across 256 consecutive operations',{timeout:5000},async()=>{
  const {socket,session}=open({});
  try{
    for(let i=0;i<256;i++){
      await session.healthCheckForPool(5000);
      assert.equal(socket.commands,i+1);
      assert.equal(session.closed,false);
    }
  }finally{await session.close();}
  assert.equal(socket.destroyed,true);
});

test('contended commands remain FIFO and queue cancellation cannot block successors',{timeout:5000},async()=>{
  const {socket,session}=open({holdFirst:true});
  try{
    const first=session.healthCheckForPool(5000);
    await microtasks();
    assert.equal(socket.firstWaiting,true);
    const aborted=Array.from({length:12},()=>new AbortController());
    const rejected=aborted.map(controller=>session.query('SELECT 1',[],{
      signal:controller.signal
    }));
    const order=[];
    const waiting=Array.from({length:48},(_,index)=>
      session.healthCheckForPool(5000).then(()=>{order.push(index);}));
    for(const controller of aborted)controller.abort();
    const outcomes=await Promise.allSettled(rejected);
    assert.ok(outcomes.every(x=>x.status==='rejected'&&x.reason.code==='CANCELLED'));
    assert.equal(socket.commands,1,'queued and cancelled commands must not be transmitted');
    socket.release();
    await first;
    await Promise.all(waiting);
    assert.deepEqual(order,Array.from({length:48},(_,i)=>i));
    assert.equal(socket.commands,49);
    assert.equal(session.closed,false);
  }finally{await session.close();}
});

test('abort during listener registration skips direct-start command without closing connection',{timeout:5000},async()=>{
  const {socket,session}=open({});
  const signal={
    aborted:false,
    addEventListener(_event,listener){
      this.aborted=true;
      listener();
    },
    removeEventListener(){}
  };
  try{
    await assert.rejects(session.query('SELECT 1',[],{signal}),
      error=>error.code==='CANCELLED');
    assert.equal(socket.commands,0);
    assert.equal(session.closed,false);
    await session.healthCheckForPool(5000);
    assert.equal(socket.commands,1);
  }finally{await session.close();}
});

test('shutdown interrupts active command and rejects FIFO backlog without late writes',{timeout:5000},async()=>{
  const {socket,session}=open({holdFirst:true});
  const first=session.healthCheckForPool(5000);
  void first.catch(()=>{});
  await microtasks();
  assert.equal(socket.firstWaiting,true);
  const waiting=Array.from({length:64},()=>
    session.healthCheckForPool(5000));
  const settled=Promise.allSettled(waiting);
  await session.close();
  await assert.rejects(first,e=>e.code==='CONNECTION_CLOSED');
  const results=await settled;
  assert.ok(results.every(x=>x.status==='rejected'&&
    x.reason.code==='CONNECTION_CLOSED'));
  assert.equal(socket.commands,1);
  assert.equal(socket.destroyed,true);
});
