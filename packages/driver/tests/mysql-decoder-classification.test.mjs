import {test} from 'node:test';
import assert from 'node:assert/strict';
import {binaryValues} from '../dist/vendors/mysql/types.js';
import {T,sized} from '../dist/vendors/mysql/protocol/primitives.js';

const column=(type,charset=45)=>({
  name:'value',type,charset,length:64,flags:0,decimals:0,unsigned:false,
  schema:null,table:null,originalName:null,originalTable:null
});
const wire=bytes=>Buffer.concat([Buffer.from([0,0]),bytes]);

test('UTF-8 collation classification preserves every edge of supported ranges',()=>{
  const accepted=[33,45,46,83,255,11,65,192,215,224,247,256,309];
  for(const charset of accepted){
    const packet=wire(sized(Buffer.from('Straße','utf8')));
    for(const type of [T.VAR_STRING,T.VARCHAR,T.BLOB,T.STRING]){
      assert.equal(binaryValues(packet,[column(type,charset)])[0],
        'Straße',`type ${type} collation ${charset}`);
    }
  }
  for(const charset of [0,7,9,34,44,84,191,216,223,248,254,310,65535]){
    assert.throws(()=>binaryValues(wire(sized(Buffer.from('x'))),[
      column(T.VAR_STRING,charset)
    ]),/Unsupported MySQL result character-set/);
  }
});

test('Latin-1 and binary result handling preserve bytes and decoded text exactly',()=>{
  for(const charset of [8,15,31,47,48,49,94]){
    assert.equal(binaryValues(wire(sized(Buffer.from([0x63,0x61,0x66,0xe9]))),[
      column(T.STRING,charset)
    ])[0],'café');
  }
  const bytes=Buffer.from([0xff,0x80,0,0x61]);
  for(const type of [T.BLOB,T.TINY_BLOB,T.MEDIUM_BLOB,T.LONG_BLOB,
    T.VARCHAR,T.VAR_STRING,T.STRING]){
    assert.deepEqual(binaryValues(wire(sized(bytes)),[
      column(type,63)
    ])[0],bytes);
  }
});

test('decimal, JSON, ENUM and SET branches remain lossless',()=>{
  for(const type of [T.DECIMAL,T.NEWDECIMAL]){
    assert.equal(binaryValues(wire(sized(Buffer.from(
      '-12345678901234567890.00001'
    ))),[column(type,63)])[0],'-12345678901234567890.00001');
  }
  const json='{"a":12345678901234567890}';
  assert.equal(binaryValues(wire(sized(Buffer.from(json))),[
    column(T.JSON,63)
  ])[0],json);
  for(const type of [T.ENUM,T.SET]){
    assert.equal(binaryValues(wire(sized(Buffer.from('ab'))),[
      column(type,45)
    ])[0],'ab');
  }
});

test('all temporal type dispatches preserve zero-wire representations',()=>{
  for(const type of [T.DATE,T.TIME,T.DATETIME,T.TIMESTAMP]){
    const value=binaryValues(wire(Buffer.from([0])),[column(type)])[0];
    assert.equal(value,type===T.TIME?'00:00:00':
      type===T.DATE?'0000-00-00':'0000-00-00 00:00:00');
  }
});

test('NULL bitmap, unknown types and malformed text still fail closed',()=>{
  const cols=[column(T.TINY),column(T.VAR_STRING)];
  const packet=Buffer.concat([Buffer.from([0,0x04]),sized(Buffer.from('é'))]);
  assert.deepEqual(binaryValues(packet,cols),[null,'é']);
  assert.throws(()=>binaryValues(wire(sized(Buffer.from('abc'))),[
    column(241)
  ]),/Unsupported MySQL binary result type/);
  assert.throws(()=>binaryValues(wire(sized(Buffer.from([0xff]))),[
    column(T.STRING,45)
  ]),/encoded data|valid|UTF-8/i);
});
