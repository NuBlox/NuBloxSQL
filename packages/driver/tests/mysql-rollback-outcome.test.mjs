import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PacketStream} from '../dist/vendors/mysql/protocol/framing.js';
import {MysqlSession} from '../dist/vendors/mysql/adapter.js';

class FakeSocket extends EventEmitter {
  destroyed=false;
  writes=0;
  write(_data,callback){this.writes++;callback?.();return true;}
  destroy(){
    if(!this.destroyed){
      this.destroyed=true;
      this.emit('close');
    }
    return this;
  }
}

function sessionFixture(){
  const socket=new FakeSocket();
  const stream=new PacketStream(socket);
  const session=new MysqlSession(stream,socket,{
    engine:'mysql',host:'127.0.0.1',port:3306,user:'fixture',
    password:'',database:'',security:'isolated-local',timeoutMs:2000
  },{
    version:'8.4.11-fixture',plugin:'caching_sha2_password',
    seed:Buffer.alloc(20),id:1,flags:0
  });
  return {session,socket,stream};
}

test('failed rollback is attempted once, closes the session and reports uncertain outcome',async()=>{
  const {session,socket}=sessionFixture();
  const commands=[];
  session.control=async command=>{
    commands.push(command);
    if(command==='ROLLBACK')throw Error('unconfirmed rollback');
    return {rows:[],columns:[],affectedRows:0,insertId:0};
  };
  const original=Error('application callback rejected');
  await assert.rejects(session.transaction(async()=>{throw original;}),
    error=>error.code==='TRANSACTION_OUTCOME_UNKNOWN'&&
      /ROLLBACK acknowledgement/.test(error.message));
  assert.deepEqual(commands,['START TRANSACTION','ROLLBACK'],
    'cleanup must never replay a rollback after its first failure');
  assert.equal(socket.destroyed,true);
  assert.equal(session.closed,true);
  await assert.rejects(session.query('SELECT 1'),
    error=>error.code==='CONNECTION_CLOSED');
  await session.close();
});

test('confirmed rollback preserves application error and the reusable native session',async()=>{
  const {session,socket}=sessionFixture();
  const commands=[];
  session.control=async command=>{
    commands.push(command);
    return {rows:[],columns:[],affectedRows:0,insertId:0};
  };
  const original=Error('application error');
  await assert.rejects(session.transaction(async()=>{throw original;}),
    error=>error===original);
  assert.deepEqual(commands,['START TRANSACTION','ROLLBACK']);
  assert.equal(session.closed,false);
  assert.equal(socket.destroyed,false);
  await session.close();
  assert.equal(socket.destroyed,true);
});

test('unexpected loss while waiting for ROLLBACK is surfaced as unknown',async()=>{
  const {session,socket}=sessionFixture();
  const commands=[];
  session.control=async command=>{
    commands.push(command);
    if(command==='ROLLBACK'){
      // Model the native command having been transmitted but losing its
      // acknowledgement while the active operation is waiting.
      session.rollbackAwaitingAck=true;
      socket.destroy();
      await new Promise(()=>{});
    }
    return {rows:[],columns:[],affectedRows:0,insertId:0};
  };
  await assert.rejects(session.transaction(async()=>{throw Error('abort');}),
    error=>error.code==='TRANSACTION_OUTCOME_UNKNOWN'&&
      /ROLLBACK acknowledgement/.test(error.message));
  assert.deepEqual(commands,['START TRANSACTION','ROLLBACK']);
  assert.equal(session.closed,true);
  await session.close();
});
