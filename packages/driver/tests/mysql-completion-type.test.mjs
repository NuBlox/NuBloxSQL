import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PacketStream} from '../dist/vendors/mysql/protocol/framing.js';
import {MysqlSession} from '../dist/vendors/mysql/adapter.js';

class FixtureSocket extends EventEmitter{
  destroyed=false;
  destroy(){
    if(!this.destroyed){
      this.destroyed=true;
      this.emit('close');
    }
    return this;
  }
}
function fixture(statuses){
  const socket=new FixtureSocket();
  const stream=new PacketStream(socket);
  const session=new MysqlSession(stream,socket,{
    engine:'mysql',host:'127.0.0.1',port:3306,user:'fixture',
    password:'',database:'',security:'isolated-local',timeoutMs:2000
  },{
    version:'8.4-fixture',plugin:'caching_sha2_password',
    seed:Buffer.alloc(20),id:1,flags:0
  });
  const commands=[];
  stream.send=async body=>{commands.push(body);};
  stream.read=async()=>{
    if(statuses.length===0)throw Error('No fixture response');
    const status=statuses.shift();
    return Buffer.from([0,0,0,status&255,(status>>8)&255,0,0]);
  };
  return {session,socket,commands};
}
const statement=body=>body.subarray(1).toString('ascii');

test('native transaction commands override server CHAIN and RELEASE defaults',async()=>{
  const {session,socket,commands}=fixture([3,2,3,2]);
  try{
    await session.control('START TRANSACTION');
    await session.control('COMMIT');
    await session.control('START TRANSACTION');
    await session.control('ROLLBACK');
    assert.deepEqual(commands.map(statement),[
      'START TRANSACTION','COMMIT AND NO CHAIN NO RELEASE',
      'START TRANSACTION','ROLLBACK AND NO CHAIN NO RELEASE'
    ]);
    assert.ok(commands.every(command=>command[0]===3),'each command uses COM_QUERY');
    assert.equal(session.closed,false);
    assert.equal(socket.destroyed,false);
  }finally{await session.close();}
});

test('START TRANSACTION missing native IN_TRANS is rejected before callback',async()=>{
  const {session,socket,commands}=fixture([2]);
  await assert.rejects(session.control('START TRANSACTION'),
    error=>error.code==='PROTOCOL_ERROR');
  assert.deepEqual(commands.map(statement),['START TRANSACTION']);
  assert.equal(session.closed,true);
  assert.equal(socket.destroyed,true);
});

test('COMMIT or ROLLBACK leaving native transaction active rejects unknown outcome',async()=>{
  for(const control of ['COMMIT','ROLLBACK']){
    const {session,socket,commands}=fixture([3]);
    await assert.rejects(session.control(control),
      error=>error.code==='TRANSACTION_OUTCOME_UNKNOWN');
    assert.deepEqual(commands.map(statement),[control+' AND NO CHAIN NO RELEASE']);
    assert.equal(session.closed,true);
    assert.equal(socket.destroyed,true);
    await session.close();
  }
});

test('missing transaction-control acknowledgement is never a success',async()=>{
  const {session,socket,commands}=fixture([]);
  await assert.rejects(session.control('COMMIT'));
  assert.deepEqual(commands.map(statement),['COMMIT AND NO CHAIN NO RELEASE']);
  await session.close();
  assert.equal(socket.destroyed,true);
});
