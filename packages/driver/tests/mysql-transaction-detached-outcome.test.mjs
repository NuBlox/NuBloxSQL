import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PacketStream} from '../dist/vendors/mysql/protocol/framing.js';
import {MysqlSession} from '../dist/vendors/mysql/adapter.js';
import {fail} from '../dist/core/errors.js';

class FixtureSocket extends EventEmitter {
  destroyed=false;
  destroy(){
    if(!this.destroyed){this.destroyed=true;this.emit('close');}
    return this;
  }
}
const activeResult=()=>({
  rows:[],columns:[],affectedRows:1,insertId:0,status:1
});
function fixture(execute){
  const socket=new FixtureSocket();
  const session=new MysqlSession(new PacketStream(socket),socket,{
    engine:'mysql',host:'127.0.0.1',port:3306,user:'fixture',
    password:'',security:'isolated-local',timeoutMs:2000
  },{
    version:'8.4-fixture',plugin:'caching_sha2_password',
    seed:Buffer.alloc(20),id:1,flags:0
  });
  const commands=[];
  session.control=async command=>{
    commands.push(command);
    return activeResult();
  };
  session.executeResults=execute;
  return {session,socket,commands};
}
const unknown=error=>error.code==='TRANSACTION_OUTCOME_UNKNOWN'&&
  /SQL outcome may be unknown/.test(error.message);

test('callback success with in-flight write rejects as unknown, without COMMIT or replay',async()=>{
  let started,release,commandsExecuted=0,detached;
  const entered=new Promise(resolve=>{started=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const {session,socket,commands}=fixture(async()=>{
    commandsExecuted++;
    started();
    await gate;
    // Simulate a native response arriving AFTER the callback and socket close.
    return [activeResult()];
  });
  try{
    const transaction=session.transaction(async tx=>{
      detached=tx.query('UPDATE critical_write SET value = 2');
      void detached.catch(()=>{});
      await entered;
      return 'not-a-commit';
    });
    await assert.rejects(transaction,unknown);
    assert.equal(socket.destroyed,true);
    assert.equal(session.closed,true);
    assert.deepEqual(commands,['START TRANSACTION'],'no COMMIT or ROLLBACK confirmation');
    release();
    await assert.rejects(detached,unknown);
    assert.equal(commandsExecuted,1,'never replay a potentially applied write');
    await assert.rejects(session.query('SELECT 1'),e=>e.code==='CONNECTION_CLOSED');
  }finally{release?.();await session.close();}
});

test('callback failure with unfinished write supersedes application error with uncertain outcome',async()=>{
  let started,release,detached;
  const entered=new Promise(resolve=>{started=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const {session,socket,commands}=fixture(async()=>{
    started();
    await gate;
    throw fail('DATABASE_ERROR','late SQL error');
  });
  try{
    const transaction=session.transaction(async tx=>{
      detached=tx.query('INSERT INTO critical_write VALUES (1)');
      void detached.catch(()=>{});
      await entered;
      throw Error('user failed before write settled');
    });
    await assert.rejects(transaction,unknown);
    assert.deepEqual(commands,['START TRANSACTION'],'do not claim confirmed rollback');
    assert.equal(socket.destroyed,true);
    release();
    await assert.rejects(detached,unknown);
  }finally{release?.();await session.close();}
});

test('fully awaited scoped work can commit and preserve usable native session',async()=>{
  const {session,socket,commands}=fixture(async()=>[activeResult()]);
  try{
    assert.equal(await session.transaction(async tx=>{
      await tx.query('UPDATE safe_work SET value = 7');
      return 'confirmed';
    }),'confirmed');
    assert.deepEqual(commands,['START TRANSACTION','COMMIT']);
    assert.equal(session.closed,false);
    assert.equal(socket.destroyed,false);
  }finally{await session.close();}
});
