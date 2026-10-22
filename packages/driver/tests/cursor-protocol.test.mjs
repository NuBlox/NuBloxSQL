import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execute,fetchRows} from '../dist/vendors/mysql/protocol/commands.js';
import {MysqlCursor} from '../dist/vendors/mysql/cursor.js';
import {readMetadataWithStatus} from '../dist/vendors/mysql/metadata.js';

test('native command flags and COM_STMT_FETCH encode read-only bounded cursor requests',()=>{
 const prepared=execute(0x12345678,[10],true);
 assert.equal(prepared[0],0x17);
 assert.equal(prepared.readUInt32LE(1),0x12345678);
 assert.equal(prepared[5],1);
 assert.equal(execute(11,[10])[5],0);
 const request=fetchRows(0x12345678,256);
 assert.deepEqual(request,Buffer.from([0x1c,0x78,0x56,0x34,0x12,0,1,0,0]));
 for(const n of [0,257,-1,1.2,NaN])
  assert.throws(()=>fetchRows(1,n),/1–256/);
});
test('cursor has bounded fetched batches, supports manual close and remains forward-only',async()=>{
 let fetches=0;
 const cursor=new MysqlCursor([{name:'x'}],['x'],async()=>{
  fetches++;
  if(fetches===1)return {rows:[{row:{x:1},values:[1]},{row:{x:2},values:[2]}],done:false};
  return {rows:[{row:{x:3},values:[3]}],done:true};
 });
 const rows=[];
 for await(const value of cursor)rows.push(value.values[0]);
 assert.deepEqual(rows,[1,2,3]);
 assert.equal(fetches,2);
 assert.equal(cursor.closed,true);
 assert.deepEqual(await cursor.next(),{done:true,value:undefined});
 assert.ok(Object.isFrozen(cursor.columnKeys));
});
test('cursor cannot start simultaneous fetches',async()=>{
 let release;
 const barrier=new Promise(resolve=>{release=resolve;});
 const cursor=new MysqlCursor([],[],async()=>{await barrier;return {rows:[],done:true};});
 const first=cursor.next();
 await assert.rejects(cursor.next(),e=>e.code==='INVALID_INPUT');
 release();
 await first;
 assert.equal(cursor.closed,true);
});
test('cursor early return discards pending rows without fetching again',async()=>{
 let fetches=0;
 const cursor=new MysqlCursor([],[],async()=>{
  fetches++;return {rows:[{row:{value:1},values:[1]}],done:false};
 });
 assert.equal((await cursor.next()).value.values[0],1);
 await cursor.return();
 assert.deepEqual(await cursor.next(),{done:true,value:undefined});
 assert.equal(fetches,1);
});
