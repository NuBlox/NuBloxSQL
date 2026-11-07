import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {cursorRowStream} from '../dist/core/row-stream.js';
import {MysqlCursor} from '../dist/vendors/mysql/cursor.js';

function fixture(total=30,batchSize=5){
  let nextValue=0,fetches=0;
  const columns=Object.freeze([{name:'value'}]);
  const keys=Object.freeze(['value']);
  const cursor=new MysqlCursor(columns,keys,async()=>{
    fetches++;
    const rows=[];
    while(rows.length<batchSize&&nextValue<total){
      const value=nextValue++;
      rows.push({row:{value},values:[value]});
    }
    return {rows,done:nextValue===total};
  });
  return {cursor,get fetches(){return fetches;}};
}

test('row stream is lazy, exposes lossless metadata and observes demand',async()=>{
  const f=fixture(7,3);
  const stream=cursorRowStream(f.cursor,1);
  assert.equal(f.fetches,0,'no COM_STMT_FETCH before downstream demand');
  assert.strictEqual(stream.columns,f.cursor.columns);
  assert.strictEqual(stream.columnKeys,f.cursor.columnKeys);
  assert.equal(stream.readableObjectMode,true);
  assert.equal(stream.readableHighWaterMark,1);
  assert.equal(Object.getOwnPropertyDescriptor(stream,'columns').writable,false);
  const collected=[];
  for await(const item of stream)collected.push(item.values[0]);
  assert.deepEqual(collected,[0,1,2,3,4,5,6]);
  assert.ok(f.fetches>=3);
  assert.equal(f.cursor.closed,true);
});

test('slow Node Writable applies row-object backpressure without eager fetch',async()=>{
  const f=fixture(40,5);
  const source=cursorRowStream(f.cursor,2);
  let received=0,maxBuffered=0;
  const sink=new Writable({
    objectMode:true,highWaterMark:1,
    write(item,_encoding,callback){
      maxBuffered=Math.max(maxBuffered,source.readableLength);
      assert.equal(item.values[0],received++);
      setImmediate(callback);
    }
  });
  await pipeline(source,sink);
  assert.equal(received,40);
  assert.ok(maxBuffered<=2,'Readable must respect its row high-water mark');
  assert.ok(f.fetches>=8);
  assert.equal(f.cursor.closed,true);
});

test('early async-iterator break closes the source cursor',async()=>{
  const f=fixture(30,3);
  const stream=cursorRowStream(f.cursor,1);
  let rows=0;
  for await(const {values} of stream){
    assert.equal(values[0],0);
    rows++;
    break;
  }
  assert.equal(rows,1);
  // Readable destroys its underlying async iterator on early return.
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.cursor.closed,true);
  assert.equal(stream.destroyed,true);
});

test('a native cursor failure reaches the Node stream as an error',async()=>{
  const cursor=new MysqlCursor([],[],async()=>{
    throw Error('fabricated native fetch failure');
  });
  const stream=cursorRowStream(cursor,2);
  await assert.rejects(async()=>{
    for await(const _ of stream){}
  },/fabricated native fetch failure/);
  assert.equal(stream.destroyed,true);
});

test('stream queue capacity is validated before native iteration',()=>{
  const f=fixture(4);
  for(const invalid of [0,33,-1,1.5,'2',NaN,Infinity]){
    assert.throws(()=>cursorRowStream(f.cursor,invalid),
      error=>error.code==='INVALID_INPUT');
  }
  assert.equal(f.fetches,0);
});
