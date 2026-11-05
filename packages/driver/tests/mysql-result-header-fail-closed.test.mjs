import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PacketStream} from '../dist/vendors/mysql/protocol/framing.js';
import {MysqlSession} from '../dist/vendors/mysql/adapter.js';
import {T,sized,u16,u32} from '../dist/vendors/mysql/protocol/primitives.js';
import {MAX_PACKET_BYTES} from '../dist/core/resources.js';

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

function fixture(header){
  const replies=Array.isArray(header)?[...header]:[header];
  const socket=new FixtureSocket();
  const stream=new PacketStream(socket);
  const session=new MysqlSession(stream,socket,{
    engine:'mysql',host:'127.0.0.1',port:3306,user:'fixture',
    password:'',security:'isolated-local',timeoutMs:2000
  },{
    version:'8.4-fixture',id:1,flags:0,
    seed:Buffer.alloc(20),plugin:'caching_sha2_password'
  });
  const sent=[];
  let preparedClosed=false;
  session.prepareNative=async()=>({id:17,parameterCount:0});
  session.closeNative=async()=>{
    preparedClosed=true;
    sent.push(Buffer.from([0x19]));
  };
  stream.send=async packet=>sent.push(Buffer.from(packet));
  stream.read=async()=>{
    if(!replies.length)throw Error('Unexpected fixture packet read');
    return replies.shift();
  };
  return {socket,session,sent,get preparedClosed(){return preparedClosed;}};
}

test('query rejects a malformed binary result header and revokes the native session',async()=>{
  for(const header of [Buffer.from([1,0x42]),Buffer.from([0xfb]),Buffer.from([0xfc,1])]){
    const f=fixture(header);
    await assert.rejects(f.session.query('SELECT 1'),
      error=>error.code==='PROTOCOL_ERROR');
    assert.deepEqual(f.sent.map(packet=>packet[0]),[0x17],
      'never send COM_STMT_CLOSE into an untrusted result stream');
    assert.equal(f.preparedClosed,false);
    assert.equal(f.session.closed,true);
    assert.equal(f.socket.destroyed,true);
    await assert.rejects(f.session.query('SELECT 2'),
      error=>error.code==='CONNECTION_CLOSED');
  }
});

test('cursor never sends COM_STMT_CLOSE after a malformed binary result header',async()=>{
  for(const header of [Buffer.from([1,0x42]),Buffer.from([0xfb])]){
    const f=fixture(header);
    let invoked=false;
    await assert.rejects(f.session.withCursor('SELECT 1',[],async()=>{
      invoked=true;
    }),error=>error.code==='PROTOCOL_ERROR');
    assert.equal(invoked,false);
    assert.deepEqual(f.sent.map(packet=>packet[0]),[0x17],
      'malformed header must revoke connection before cursor cleanup');
    assert.equal(f.preparedClosed,false);
    assert.equal(f.session.closed,true);
    assert.equal(f.socket.destroyed,true);
  }
});

const validColumn=Buffer.concat([
  ...['def','','','','value',''].map(value=>sized(Buffer.from(value))),
  Buffer.from([12]),u16(45),u32(1),Buffer.from([T.TINY]),
  u16(0),Buffer.from([0,0,0])
]);

test('malformed cursor column metadata and EOF fail closed before statement cleanup',async()=>{
  for(const packets of [
    [Buffer.from([1]),Buffer.from([0xfb])],
    [Buffer.from([1]),validColumn,Buffer.from([0xfe])]
  ]){
    const f=fixture(packets);
    let callbackCalled=false;
    await assert.rejects(f.session.withCursor('SELECT 1',[],async()=>{
      callbackCalled=true;
    }),error=>error.code==='PROTOCOL_ERROR');
    assert.equal(callbackCalled,false);
    assert.deepEqual(f.sent.map(packet=>packet[0]),[0x17],
      'never send COM_STMT_CLOSE into an incomplete metadata response');
    assert.equal(f.preparedClosed,false);
    assert.equal(f.session.closed,true);
    assert.equal(f.socket.destroyed,true);
    await assert.rejects(f.session.query('SELECT 2'),
      error=>error.code==='CONNECTION_CLOSED');
  }
});

const metadataEof=Buffer.from([0xfe,0,0,2,0]);
const firstResultEof=Buffer.from([0xfe,0,0,8,0]);
const lastResultEof=Buffer.from([0xfe,0,0,2,0]);
const binaryTinyRow=value=>Buffer.from([0,0,value]);
const resultPackets=(column,row,end)=>[
  Buffer.from([1]),column,metadataEof,binaryTinyRow(row),end
];

test('multiple valid prepared binary result sets retain row data and close safely',async()=>{
  const f=fixture([
    ...resultPackets(validColumn,42,firstResultEof),
    ...resultPackets(validColumn,43,lastResultEof)
  ]);
  try{
    const results=await f.session.queryResults('CALL two_results()');
    assert.equal(results.length,2);
    assert.equal(results[0].rows[0].value,42);
    assert.equal(results[1].rows[0].value,43);
    assert.deepEqual(f.sent.map(packet=>packet[0]),[0x17,0x19],
      'successful execution must close its native prepared statement');
    assert.equal(f.preparedClosed,true);
    assert.equal(f.session.closed,false);
  }finally{await f.session.close();}
});

test('multi-result metadata is limited across the entire server response',async()=>{
  // Each column definition is individually valid, and each result set is
  // below the per-set metadata limit. The combined response is not.
  const largeOriginalTable=Buffer.alloc(Math.ceil(MAX_PACKET_BYTES/2),0x78);
  const wideColumn=Buffer.concat([
    sized(Buffer.from('def')),sized(Buffer.alloc(0)),sized(Buffer.alloc(0)),
    sized(largeOriginalTable),sized(Buffer.from('value')),sized(Buffer.alloc(0)),
    Buffer.from([12]),u16(45),u32(1),Buffer.from([T.TINY]),
    u16(0),Buffer.from([0,0,0])
  ]);
  assert.ok(wideColumn.length<MAX_PACKET_BYTES);
  assert.ok(wideColumn.length*2>MAX_PACKET_BYTES);
  const f=fixture([
    ...resultPackets(wideColumn,42,firstResultEof),
    ...resultPackets(wideColumn,43,lastResultEof)
  ]);
  await assert.rejects(f.session.queryResults('CALL two_wide_results()'),
    error=>error.code==='RESOURCE_LIMIT'&&
      /Combined MySQL result response exceeds byte limit/.test(error.message));
  assert.deepEqual(f.sent.map(packet=>packet[0]),[0x17],
    'no COM_STMT_CLOSE may be sent into an unfinished multi-result response');
  assert.equal(f.preparedClosed,false);
  assert.equal(f.session.closed,true);
  assert.equal(f.socket.destroyed,true);
  await assert.rejects(f.session.query('SELECT 1'),
    error=>error.code==='CONNECTION_CLOSED');
});
