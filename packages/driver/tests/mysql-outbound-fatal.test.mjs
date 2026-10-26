import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PacketStream} from '../dist/vendors/mysql/protocol/framing.js';
import {MysqlSession} from '../dist/vendors/mysql/adapter.js';

class WriteFailureSocket extends EventEmitter {
  destroyed=false;
  writes=0;
  write(_frame,callback){
    this.writes++;
    // Simulate a write callback failing independently of an 'error' event.
    queueMicrotask(()=>callback?.(new Error('opaque socket details')));
    return false;
  }
  destroy(){
    if(!this.destroyed){
      this.destroyed=true;
      this.emit('close');
    }
    return this;
  }
}

test('outbound failure revokes the owning MySQL session and rejects queued work',async()=>{
  const socket=new WriteFailureSocket();
  const stream=new PacketStream(socket);
  const session=new MysqlSession(stream,socket,{
    engine:'mysql',host:'127.0.0.1',port:3306,
    user:'fixture',password:'',database:'',
    security:'isolated-local',timeoutMs:3000
  },{
    version:'8.4.11-fixture',plugin:'caching_sha2_password',
    seed:Buffer.alloc(20),id:1,flags:0
  });
  const active=session.healthCheckForPool(3000);
  const queued=Array.from({length:12},()=>session.healthCheckForPool(3000));
  const results=await Promise.allSettled([active,...queued]);
  assert.ok(results.every(result=>
    result.status==='rejected'&&result.reason.code==='CONNECTION_CLOSED'
  ));
  assert.equal(socket.writes,1,'no later queued operation can send SQL');
  assert.equal(socket.destroyed,true);
  assert.equal(session.closed,true);
  await assert.rejects(session.healthCheckForPool(3000),
    error=>error.code==='CONNECTION_CLOSED');
  await session.close();
});
