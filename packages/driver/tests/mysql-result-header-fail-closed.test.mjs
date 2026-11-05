import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PacketStream} from '../dist/vendors/mysql/protocol/framing.js';
import {MysqlSession} from '../dist/vendors/mysql/adapter.js';
import {T,sized,u16,u32} from '../dist/vendors/mysql/protocol/primitives.js';
import {MAX_PACKET_BYTES,MAX_RESULT_CELLS} from '../dist/core/resources.js';

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

test('compact all-NULL rows cannot exceed the buffered result-cell limit',async()=>{
  // A 1,000-column NULL row consumes only a 127-byte wire bitmap, but
  // materializes 1,000 array elements and 1,000 row-object properties.
  // The 1,001st row crosses the 1,000,000-cell execution-wide ceiling.
  const columnCount=1000;
  assert.equal(MAX_RESULT_CELLS,1_000_000);
  const cols=Array.from({length:columnCount},(_,i)=>Buffer.concat([
    sized(Buffer.from('def')),sized(Buffer.alloc(0)),sized(Buffer.alloc(0)),
    sized(Buffer.alloc(0)),sized(Buffer.from('field_'+i)),
    sized(Buffer.alloc(0)),
    Buffer.from([12]),u16(63),u32(1),Buffer.from([T.TINY]),
    u16(0),Buffer.from([0,0,0])
  ]));
  const bitmap=Buffer.alloc(Math.ceil((columnCount+2)/8),0xff);
  bitmap[0]&=0xfc; // the two leading bitmap bits are reserved
  const row=Buffer.concat([Buffer.from([0]),bitmap]);
  const wireBytes=(1001*row.length)+cols.reduce((n,col)=>n+col.length,0);
  assert.ok(wireBytes<MAX_PACKET_BYTES,
    'the wire-byte limit must not be the reason this fixture fails');
  const f=fixture([
    Buffer.from([0xfc,columnCount&255,columnCount>>8]),
    ...cols,
    metadataEof,
    ...Array(1001).fill(row),
    lastResultEof
  ]);
  await assert.rejects(f.session.queryResults('SELECT many_nulls'),
    error=>error.code==='RESOURCE_LIMIT'&&
      /materialized cell limit/.test(error.message));
  assert.deepEqual(f.sent.map(packet=>packet[0]),[0x17],
    'do not send COM_STMT_CLOSE into an unfinished server response');
  assert.equal(f.preparedClosed,false);
  assert.equal(f.session.closed,true);
  assert.equal(f.socket.destroyed,true);
  await assert.rejects(f.session.query('SELECT 1'),
    error=>error.code==='CONNECTION_CLOSED');
});

test('decoded text can exhaust heap estimate before the valid wire response limit',async()=>{
  // ASCII remains small on the wire but is budgeted conservatively as
  // two bytes per JavaScript string code unit, plus result-object storage.
  const length=MAX_PACKET_BYTES-80;
  const textColumn=Buffer.concat([
    ...['def','','','','text_value',''].map(value=>sized(Buffer.from(value))),
    Buffer.from([12]),u16(45),u32(MAX_PACKET_BYTES),
    Buffer.from([T.VAR_STRING]),u16(0),Buffer.from([0,0,0])
  ]);
  const largeRow=Buffer.concat([
    Buffer.from([0,0]),sized(Buffer.alloc(length,0x61))
  ]);
  const totalWireBytes=1+textColumn.length+metadataEof.length+
    largeRow.length+lastResultEof.length;
  assert.ok(totalWireBytes<MAX_PACKET_BYTES,
    'the response must be legal under the independent wire budget');
  const f=fixture([Buffer.from([1]),textColumn,metadataEof,largeRow,lastResultEof]);
  await assert.rejects(f.session.query('SELECT giant_text'),
    error=>error.code==='RESOURCE_LIMIT'&&
      /materialized result exceeds memory budget/.test(error.message));
  assert.deepEqual(f.sent.map(packet=>packet[0]),[0x17],
    'reject oversized decoded result without COM_STMT_CLOSE');
  assert.equal(f.preparedClosed,false);
  assert.equal(f.session.closed,true);
  assert.equal(f.socket.destroyed,true);
  await assert.rejects(f.session.query('SELECT 1'),
    error=>error.code==='CONNECTION_CLOSED');
});
