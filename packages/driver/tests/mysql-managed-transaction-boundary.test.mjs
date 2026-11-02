import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PacketStream} from '../dist/vendors/mysql/protocol/framing.js';
import {MysqlSession} from '../dist/vendors/mysql/adapter.js';
import {fail} from '../dist/core/errors.js';

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


test('SQL ERR while server remains in the transaction keeps original error and rolls back',async()=>{
  const {session,controls,socket}=fixture([]);
  const original=fail('DATABASE_ERROR','duplicate key');
  session.executeNativeResults=async()=>{throw original;};
  const pings=[];
  session.send=async packet=>{pings.push(Buffer.from(packet));};
  session.get=async()=>Buffer.from([0,0,0,1,0,0,0]); // OK, IN_TRANS
  await assert.rejects(session.transaction(async tx=>{
    await tx.query('INSERT duplicate');
  }),error=>error===original);
  assert.deepEqual(pings,[Buffer.from([0x0e])],'one COM_PING on the original socket');
  assert.deepEqual(controls,['START TRANSACTION','ROLLBACK']);
  assert.equal(session.closed,false);
  await session.close();
  assert.equal(socket.destroyed,true);
});

test('SQL ERR after implicit commit is reported unknown without issuing ROLLBACK',async()=>{
  for(const method of ['query','queryResults']){
    const {session,controls,socket}=fixture([]);
    session.executeNativeResults=async()=>{throw fail('DATABASE_ERROR','DDL rejected');};
    const pings=[];
    session.send=async packet=>{pings.push(Buffer.from(packet));};
    session.get=async()=>Buffer.from([0,0,0,2,0,0,0]); // OK, AUTOCOMMIT; no IN_TRANS
    await assert.rejects(session.transaction(async tx=>{
      await tx[method]('ALTER TABLE failed');
    }),error=>error.code==='TRANSACTION_OUTCOME_UNKNOWN');
    assert.deepEqual(pings,[Buffer.from([0x0e])]);
    assert.deepEqual(controls,['START TRANSACTION']);
    assert.equal(session.closed,true);
    assert.equal(socket.destroyed,true);
  }
});

test('a failed transaction-state probe never reports definite rollback',async()=>{
  const {session,controls,socket}=fixture([]);
  session.executeNativeResults=async()=>{throw fail('DATABASE_ERROR','SQL rejected');};
  session.send=async()=>{};
  session.get=async()=>{throw fail('CONNECTION_CLOSED','missing PING response');};
  await assert.rejects(session.transaction(async tx=>{
    await tx.query('ALTER TABLE failed');
  }),error=>error.code==='TRANSACTION_OUTCOME_UNKNOWN'&&
    /could not be verified/.test(error.message));
  assert.deepEqual(controls,['START TRANSACTION']);
  assert.equal(session.closed,true);
  assert.equal(socket.destroyed,true);
});

test('callback may handle recoverable SQL ERR and still commit its active transaction',async()=>{
  const {session,controls}=fixture([]);
  const original=fail('DATABASE_ERROR','constraint violation');
  let executions=0;
  session.executeNativeResults=async()=>{
    executions++;
    if(executions===1)throw original;
    return [row(1)];
  };
  session.send=async()=>{};
  session.get=async()=>Buffer.from([0,0,0,1,0,0,0]);
  const value=await session.transaction(async tx=>{
    await assert.rejects(tx.queryResults('INSERT rejected'),error=>error===original);
    await tx.query('SELECT succeeding');
    return 'committed';
  });
  assert.equal(value,'committed');
  assert.deepEqual(controls,['START TRANSACTION','COMMIT']);
  assert.equal(session.closed,false);
  await session.close();
});
