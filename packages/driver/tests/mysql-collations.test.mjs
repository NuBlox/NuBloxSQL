import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  ADDITIONAL_MYSQL_COLLATIONS,decodeMysqlText
} from '../dist/vendors/mysql/collations.js';
import {binaryValues} from '../dist/vendors/mysql/types.js';
import {textValues} from '../dist/vendors/mysql/text-results.js';
import {T,size,sized} from '../dist/vendors/mysql/protocol/primitives.js';

const column=(charset,type=T.VAR_STRING)=>({
  name:'international',type,charset,length:255,flags:0,decimals:0,
  unsigned:false,schema:null,table:null,originalName:null,originalTable:null
});
const binaryRow=(bytes)=>Buffer.concat([Buffer.from([0,0]),sized(bytes)]);
const textRow=bytes=>Buffer.concat([size(bytes.length),bytes]);

test('additional mapping is immutable, unique and excludes binary pseudo-collation',()=>{
  const ids=ADDITIONAL_MYSQL_COLLATIONS.map(([id])=>id);
  assert.equal(new Set(ids).size,ids.length);
  assert.ok(!ids.includes(63));
  assert.ok(Object.isFrozen(ADDITIONAL_MYSQL_COLLATIONS));
  assert.ok(ADDITIONAL_MYSQL_COLLATIONS.every(Object.isFrozen));
});

test('CJK and legacy European collations decode identically in both MySQL protocols',()=>{
  const cases=[
    [1,Buffer.from([0xa4,0xa4]),'中'],    // big5
    [13,Buffer.from([0x93,0xfa]),'日'],   // sjis
    [95,Buffer.from([0x93,0xfa]),'日'],   // cp932
    [19,Buffer.from([0xc7,0xd1]),'한'],   // euckr
    [24,Buffer.from([0xd6,0xd0]),'中'],   // gb2312
    [28,Buffer.from([0xd6,0xd0]),'中'],   // gbk
    [248,Buffer.from([0xd6,0xd0]),'中'],  // gb18030
    [9,Buffer.from([0xa3]),'Ł'],         // latin2
    [26,Buffer.from([0xc8]),'Č'],        // cp1250
    [14,Buffer.from([0xdf]),'Я'],        // cp1251
    [25,Buffer.from([0xc1]),'Α'],        // greek
    [30,Buffer.from([0xfd]),'ı'],        // latin5
    [16,Buffer.from([0xe0]),'א'],        // hebrew
    [57,Buffer.from([0xc7]),'ا']         // cp1256
  ];
  for(const [id,bytes,expected] of cases){
    assert.equal(decodeMysqlText(bytes,id),expected,'collation '+id);
    assert.equal(binaryValues(binaryRow(bytes),[column(id)])[0],expected);
    assert.equal(textValues(textRow(bytes),[column(id)])[0],expected);
  }
});

test('UCS-2, UTF-16 BE/LE, and UTF-32 BE preserve supplementary codepoints',()=>{
  const pairs=[
    [35,Buffer.from([0x4e,0x2d]),'中'],
    [54,Buffer.from([0x00,0x41,0xd8,0x3d,0xde,0x80]),'A🚀'],
    [56,Buffer.from([0x41,0x00,0x3d,0xd8,0x80,0xde]),'A🚀'],
    [60,Buffer.from([0,0,0,0x41,0,1,0xf6,0x80]),'A🚀']
  ];
  for(const [id,bytes,expected] of pairs){
    assert.equal(decodeMysqlText(bytes,id),expected);
    assert.equal(binaryValues(binaryRow(bytes),[column(id)])[0],expected);
    assert.equal(textValues(textRow(bytes),[column(id)])[0],expected);
  }
  assert.equal(decodeMysqlText(Buffer.alloc(0),54),'');
});

test('ASCII is strict and latin1 decodes MySQL Windows-1252 repertoire',()=>{
  for(const id of [11,65]){
    assert.equal(decodeMysqlText(Buffer.from([0,65,127]),id),'\0A\x7f');
    assert.throws(()=>decodeMysqlText(Buffer.from([0x80]),id),/Non-ASCII/);
  }
  for(const id of [5,8,15,31,47,48,49,94])
    assert.equal(decodeMysqlText(Buffer.from([0x80,0xe9]),id),'€é');
});

test('invalid/truncated multibyte sequences and unpaired Unicode scalars fail',()=>{
  const corrupt=[
    [1,Buffer.from([0xa4])],
    [13,Buffer.from([0x93])],
    [28,Buffer.from([0xd6])],
    [248,Buffer.from([0x81])],
    [35,Buffer.from([0xd8,0x3d])],
    [54,Buffer.from([0x00])],
    [54,Buffer.from([0xd8,0x3d])],
    [54,Buffer.from([0xdc,0x00])],
    [54,Buffer.from([0xd8,0x3d,0x00,0x41])],
    [56,Buffer.from([0x00,0xdc])],
    [56,Buffer.from([0x3d,0xd8,0x00,0x00])],
    [60,Buffer.from([0,1,0xf6])],
    [60,Buffer.from([0,0,0xd8,0x00])],
    [60,Buffer.from([0,0x11,0,0])]
  ];
  for(const [id,bytes] of corrupt){
    assert.throws(()=>decodeMysqlText(bytes,id),undefined,
      'bad bytes '+bytes.toString('hex')+' at collation '+id);
    assert.throws(()=>textValues(textRow(bytes),[column(id)]),
      error=>error.code==='PROTOCOL_ERROR');
    assert.throws(()=>binaryValues(binaryRow(bytes),[column(id)]));
  }
  for(const id of [0,7,44,191,216,223,251,254,310,65535])
    assert.throws(()=>decodeMysqlText(Buffer.from('a'),id),
      /Unsupported MySQL result character-set/);
});

test('raw binary collation stays bytes, including invalid text encodings',()=>{
  const value=Buffer.from([0,0xff,0x80,0x41]);
  assert.deepEqual(binaryValues(binaryRow(value),[column(63,T.BLOB)])[0],
    value);
  assert.deepEqual(textValues(textRow(value),[column(63,T.VAR_STRING)])[0],
    value);
});
