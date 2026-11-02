import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PacketStream} from '../dist/vendors/mysql/protocol/framing.js';
import {MysqlSession} from '../dist/vendors/mysql/adapter.js';

class FakeSocket extends EventEmitter{
  destroyed=false;
  destroy(){
    if(!this.destroyed){
      this.destroyed=true;
      this.emit('close');
    }
    return this;
  }
}
const row=status=>({
  rows:[],columns:[],affectedRows:0,insertId:0,status
});
const fixture=(statuses)=>{
  const socket=new FakeSocket();
  const stream=new PacketStream(socket);
  const session=new MysqlSession(stream,socket,{
    engine:'mysql',host:'127.0.0.1',port:3306,user:'fixture',
    password:'',database:'',security:'isolated-local',timeoutMs:2000
  },{
    version:'8.4.11-fixture',plugin:'caching_sha2_password',
    seed:Buffer.alloc(20),id:1,flags:0
  });
  const controls=[];
  session.control=async command=>{
    controls.push(command);
    return row(command==='START TRANSACTION'?1:2);
  };
  session.prepareNative=async()=>({id:11,parameterCount:0});
  session.closeNative=async()=>{};
  session.executeNativeResults=async()=>statuses.shift()??[row(1)];
  return {socket,session,controls};
};

test('managed transaction commits only when each scoped statement preserves IN_TRANS',async()=>{
  const {socket,session,controls}=fixture([[row(1)],[row(1)]]);
  const answer=await session.transaction(async tx=>{
    const first=await tx.query('SELECT 1');
    const second=await tx.queryResults('SELECT 2');
    assert.equal(first.status,1);
    assert.equal(second[0].status,1);
    return 73;
  });
  assert.equal(answer,73);
  assert.deepEqual(controls,['START TRANSACTION','COMMIT']);
  assert.equal(session.closed,false);
  await session.close();
  assert.equal(socket.destroyed,true);
});

test('scoped query cannot report success after implicit commit',async()=>{
  const {session,socket,controls}=fixture([[row(1)],[row(2)]]);
  let secondRan=false;
  await assert.rejects(session.transaction(async tx=>{
    await tx.query('INSERT acknowledged');
    await tx.query('DDL returned OK');
    secondRan=true;
  }),error=>error.code==='TRANSACTION_OUTCOME_UNKNOWN'&&
    /previous writes may already be durable/.test(error.message));
  assert.equal(secondRan,false);
  assert.deepEqual(controls,['START TRANSACTION'],
    'do not issue a misleading COMMIT or attempt a second ROLLBACK');
  assert.equal(session.closed,true);
  assert.equal(socket.destroyed,true);
  await assert.rejects(session.query('SELECT 1'),error=>error.code==='CONNECTION_CLOSED');
});

test('scoped multi-result execution trusts only the last server transaction status',async()=>{
  const {session,controls}=fixture([[row(1),row(2)]]);
  await assert.rejects(session.transaction(async tx=>{
    await tx.queryResults('CALL procedure that committed');
  }),error=>error.code==='TRANSACTION_OUTCOME_UNKNOWN');
  assert.deepEqual(controls,['START TRANSACTION']);
  assert.equal(session.closed,true);
});

test('missing final scoped transaction status revokes connection instead of assuming safety',async()=>{
  const {session,controls}=fixture([[{rows:[],columns:[],affectedRows:0,insertId:0}]]);
  await assert.rejects(session.transaction(async tx=>{
    await tx.query('SELECT missing status');
  }),error=>error.code==='TRANSACTION_OUTCOME_UNKNOWN');
  assert.deepEqual(controls,['START TRANSACTION']);
  assert.equal(session.closed,true);
});
