import {test} from 'node:test';
import assert from 'node:assert/strict';
import {T,sized,u16,u32} from '../dist/vendors/mysql/protocol/primitives.js';
import {binaryRow,binaryValues} from '../dist/vendors/mysql/types.js';
import {textValues} from '../dist/vendors/mysql/text-results.js';

const col=(name,type,{charset=45,decimals=0,unsigned=false}={})=>({
 name,type,charset,decimals,unsigned,schema:null,table:null,length:0,flags:unsigned?32:0
});
const bytes=v=>sized(Buffer.isBuffer(v)?v:Buffer.from(v,'utf8'));
function wireRow(columns,values){
 const bitmap=Buffer.alloc(Math.ceil((columns.length+2)/8));
 const fragments=[Buffer.from([0]),bitmap];
 values.forEach((v,i)=>{
  if(v===null)bitmap[(i+2)>>3]|=1<<((i+2)%8);
  else fragments.push(v);
 });
 return Buffer.concat(fragments);
}
const decode=(columns,values)=>binaryRow(wireRow(columns,values),columns);

test('MySQL TEXT and BLOB share type codes but different collation semantics',()=>{
 const columns=[
  col('utf8_text',T.BLOB,{charset:45}),
  col('raw_blob',T.BLOB,{charset:63}),
  col('var_text',T.VAR_STRING,{charset:255}),
  col('varbinary',T.VAR_STRING,{charset:63}),
  col('latin1_text',T.STRING,{charset:8}),
  col('null_text',T.BLOB,{charset:45})
 ];
 const row=decode(columns,[
  bytes('café 🚀'),bytes(Buffer.from([0,255,128])),
  bytes('Straße'),bytes(Buffer.from([0,255])),bytes(Buffer.from([0x63,0x61,0x66,0xe9])),null
 ]);
 assert.equal(row.utf8_text,'café 🚀');
 assert.deepEqual(row.raw_blob,Buffer.from([0,255,128]));
 assert.equal(row.var_text,'Straße');
 assert.deepEqual(row.varbinary,Buffer.from([0,255]));
 assert.equal(row.latin1_text,'café');
 assert.equal(row.null_text,null);
});
test('binary result NULL bitmap rejects reserved leading bits at byte boundaries',()=>{
 for(const count of [1,5,6,7,8,14]){
  const columns=Array.from({length:count},(_,i)=>col('value'+i,T.TINY));
  const allNull=wireRow(columns,Array(count).fill(null));
  assert.deepEqual(Object.values(binaryRow(allNull,columns)),Array(count).fill(null));
  for(const bits of [0x01,0x02,0x03]){
   const malformed=Buffer.from(allNull);
   malformed[1]|=bits;
   assert.throws(()=>binaryRow(malformed,columns),/NULL bitmap reserved bits/,
    'reserved bits '+bits+' must fail for '+count+' columns');
  }
 }
 const columns=[col('first',T.TINY),col('second',T.TINY)];
 const mixed=wireRow(columns,[Buffer.from([42]),null]);
 assert.equal(binaryRow(mixed,columns).first,42);
 const bad=Buffer.from(mixed);
 bad[1]|=0x02;
 assert.throws(()=>binaryRow(bad,columns),/NULL bitmap reserved bits/);
});

test('JSON, legacy/new DECIMAL and binary BIT preserve exact wire values',()=>{
 const cols=[
  col('json_doc',T.JSON,{charset:63}),
  col('precise',T.NEWDECIMAL,{charset:63}),
  col('legacy',T.DECIMAL,{charset:63}),
  col('bits',T.BIT,{charset:63}),
  col('geometry',T.GEOMETRY,{charset:63})
 ];
 const row=decode(cols,[
  bytes('{"amount":999999999999999999999,"enabled":true}'),
  bytes('-12345678901234567890.000001'),
  bytes('999.9900'),bytes(Buffer.from([0xa5])),bytes(Buffer.from([0,1,2,3]))
 ]);
 assert.equal(row.json_doc,'{"amount":999999999999999999999,"enabled":true}');
 assert.equal(row.precise,'-12345678901234567890.000001');
 assert.equal(row.legacy,'999.9900');
 assert.deepEqual(row.bits,Buffer.from([0xa5]));
 assert.deepEqual(row.geometry,Buffer.from([0,1,2,3]));
});
test('signed and unsigned widths keep exact numeric boundaries',()=>{
 const large=Buffer.alloc(8);large.writeBigUInt64LE(18446744073709551615n);
 const negative=Buffer.alloc(8);negative.writeBigInt64LE(-9223372036854775808n);
 const u4=Buffer.alloc(4);u4.writeUInt32LE(4294967295);
 const signed4=Buffer.alloc(4);signed4.writeInt32LE(-8388608);
 const row=decode([
  col('bigunsigned',T.LONGLONG,{unsigned:true}),col('bigsigned',T.LONGLONG),
  col('intunsigned',T.LONG,{unsigned:true}),col('intsigned',T.INT24),
  col('year',T.YEAR,{unsigned:true}),col('tinynegative',T.TINY)
 ],[large,negative,u4,signed4,u16(2024),Buffer.from([0x80])]);
 assert.equal(row.bigunsigned,18446744073709551615n);
 assert.equal(row.bigsigned,-9223372036854775808n);
 assert.equal(row.intunsigned,4294967295);
 assert.equal(row.intsigned,-8388608);
 assert.equal(row.year,2024);
 assert.equal(row.tinynegative,-128);
});
test('temporal wire values preserve negative durations and six-digit fractions',()=>{
 const time=Buffer.concat([Buffer.from([12,1]),u32(1),Buffer.from([2,3,4]),u32(123456)]);
 const dt=Buffer.concat([Buffer.from([11]),u16(2024),Buffer.from([2,29,12,34,56]),u32(123456)]);
 const date=Buffer.concat([Buffer.from([4]),u16(2024),Buffer.from([2,29])]);
 const row=decode([
  col('duration',T.TIME,{decimals:6}),
  col('datetime',T.DATETIME,{decimals:6}),
  col('stamp',T.TIMESTAMP,{decimals:6}),
  col('date',T.DATE),
  col('zero_duration',T.TIME,{decimals:6}),
  col('midnight',T.DATETIME),
  col('zero_date',T.DATE)
 ],[time,dt,dt,date,Buffer.from([0]),Buffer.concat([Buffer.from([4]),u16(2024),Buffer.from([2,29])]),Buffer.from([0])]);
 assert.equal(row.duration,'-26:03:04.123456');
 assert.equal(row.datetime,'2024-02-29 12:34:56.123456');
 assert.equal(row.stamp,'2024-02-29 12:34:56.123456');
 assert.equal(row.date,'2024-02-29');
 assert.equal(row.zero_duration,'00:00:00.000000');
 assert.equal(row.midnight,'2024-02-29 00:00:00');
 assert.equal(row.zero_date,'0000-00-00');
});
test('binary decoder fails closed on invalid lengths, invalid utf8 and unknown types',()=>{
 const wrongLength=wireRow([col('time',T.TIME)], [Buffer.from([3,0,0,0])]);
 assert.throws(()=>binaryRow(wrongLength,[col('time',T.TIME)]),/TIME length/);
 assert.throws(()=>decode([col('text',T.BLOB,{charset:45})],[bytes(Buffer.from([0xff]))]),/encoded data|valid|UTF-8/i);
 assert.throws(()=>decode([col('str',T.VAR_STRING,{charset:999})],[bytes('x')]),/character-set collation/);
 assert.throws(()=>decode([col('mystery',242)],[bytes('x')]),/Unsupported MySQL binary result type/);
 assert.throws(()=>decode([col('value',T.BLOB,{charset:45})],[Buffer.from([251])]),/NULL bitmap/);
 assert.throws(()=>binaryRow(Buffer.from([0,0,1,2]),[col('x',T.TINY)]),/Trailing/);
});

test('DECIMAL wire syntax and exact digits agree across both result protocols',()=>{
 const values=['0','-0','0.000000','-0.000001','000123.4500','-12345678901234567890.000001',
   '9'.repeat(65),'-'+'9'.repeat(35)+'.'+'9'.repeat(30)];
 for(const type of [T.DECIMAL,T.NEWDECIMAL]){
  const column=col('amount',type,{charset:63});
  for(const value of values){
   const payload=bytes(value);
   assert.deepEqual(binaryValues(wireRow([column],[payload]),[column]),[value]);
   assert.deepEqual(textValues(payload,[column]),[value]);
  }
  assert.deepEqual(binaryValues(wireRow([column],[null]),[column]),[null]);
  assert.deepEqual(textValues(Buffer.from([0xfb]),[column]),[null]);
 }
});

test('DECIMAL rejects malformed bytes consistently without rounding or replacement',()=>{
 const invalid=['','-','+1','.1','1.','1..2','1e3','--1','1,2',' 1','1 ',
   '1\n','1\r','1\r\n','1\0','NaN','Infinity','１','−1'].map(value=>Buffer.from(value));
 // High-bit bytes must never be converted to apparently valid ASCII digits.
 for(const character of [0x2d,0x2e,...Array.from({length:10},(_,i)=>0x30+i)])
   invalid.push(Buffer.from([character|0x80,0x31]));
 // Exhaust all possible single-byte values, except valid standalone digits.
 for(let byte=0;byte<256;byte++)
  if(byte<0x30||byte>0x39)invalid.push(Buffer.from([byte]));
 for(const type of [T.DECIMAL,T.NEWDECIMAL]){
  const column=col('amount',type,{charset:63});
  for(const value of invalid){
   const payload=sized(value);
   assert.throws(()=>binaryValues(wireRow([column],[payload]),[column]),
    e=>e.code==='PROTOCOL_ERROR',value.toString('hex'));
   assert.throws(()=>textValues(payload,[column]),
    e=>e.code==='PROTOCOL_ERROR',value.toString('hex'));
  }
 }
});

test('MEDIUMINT domain is narrower than its four-byte binary representation',()=>{
 for(const unsigned of [false,true]){
  const column=col('medium',T.INT24,{unsigned});
  const valid=unsigned?[0,1,8388608,16777215]:[-8388608,-1,0,8388607];
  const invalid=unsigned?[16777216,4294967295]:[-2147483648,-8388609,8388608,2147483647];
  const encode=value=>{
   const raw=Buffer.alloc(4);
   unsigned?raw.writeUInt32LE(value):raw.writeInt32LE(value);
   return raw;
  };
  for(const value of valid){
   assert.deepEqual(binaryValues(wireRow([column],[encode(value)]),[column]),[value]);
   assert.deepEqual(textValues(bytes(String(value)),[column]),[value]);
  }
  for(const value of invalid){
   assert.throws(()=>binaryValues(wireRow([column],[encode(value)]),[column]),e=>e.code==='PROTOCOL_ERROR');
   assert.throws(()=>textValues(bytes(String(value)),[column]),e=>e.code==='PROTOCOL_ERROR');
  }
  if(unsigned)assert.throws(()=>textValues(bytes('-1'),[column]),e=>e.code==='PROTOCOL_ERROR');
 }
});
test('YEAR accepts only zero or the documented calendar domain irrespective of signed flag',()=>{
 for(const unsigned of [false,true]){
  const column=col('year',T.YEAR,{unsigned});
  for(const value of [0,1901,2026,2155]){
   assert.deepEqual(binaryValues(wireRow([column],[u16(value)]),[column]),[value]);
   assert.deepEqual(textValues(bytes(String(value).padStart(4,'0')),[column]),[value]);
  }
  for(const value of [1,69,1900,2156,32767,32768,65535]){
   assert.throws(()=>binaryValues(wireRow([column],[u16(value)]),[column]),e=>e.code==='PROTOCOL_ERROR');
   assert.throws(()=>textValues(bytes(String(value)),[column]),e=>e.code==='PROTOCOL_ERROR');
  }
 }
});
test('non-finite FLOAT and DOUBLE and text FLOAT overflow are rejected',()=>{
 for(const type of [T.FLOAT,T.DOUBLE]){
  const column=col('floating',type);
  const encode=value=>{
   const raw=Buffer.alloc(type===T.FLOAT?4:8);
   type===T.FLOAT?raw.writeFloatLE(value):raw.writeDoubleLE(value);
   return raw;
  };
  for(const value of [NaN,Infinity,-Infinity]){
   assert.throws(()=>binaryValues(wireRow([column],[encode(value)]),[column]),e=>e.code==='PROTOCOL_ERROR');
   assert.throws(()=>textValues(bytes(String(value)),[column]),e=>e.code==='PROTOCOL_ERROR');
  }
  const maximum=type===T.FLOAT?Math.fround(3.4028234663852886e38):Number.MAX_VALUE;
  const minimum=type===T.FLOAT?Math.fround(2**-149):Number.MIN_VALUE;
  for(const value of [0,-0,1.25,-1.25,maximum,-maximum,minimum,-minimum]){
   assert.deepEqual(binaryValues(wireRow([column],[encode(value)]),[column]),[value]);
   const text=Object.is(value,-0)?'-0':String(value);
   assert.deepEqual(textValues(bytes(text),[column]),[value]);
  }
  for(const value of ['1e999','-1e999',...(type===T.FLOAT?['1e39','-1e39']:[])]){
   assert.throws(()=>textValues(bytes(value),[column]),e=>e.code==='PROTOCOL_ERROR');
  }
 }
 // The text protocol's displayed approximation remains unchanged.
 assert.deepEqual(textValues(bytes('0.1'),[col('float',T.FLOAT)]),[0.1]);
});

const binaryDate=(year,month,day)=>Buffer.concat([Buffer.from([4]),u16(year),Buffer.from([month,day])]);
const binaryDatetime=(year,month,day,hour,minute,second,microseconds)=>Buffer.concat([
 Buffer.from([11]),u16(year),Buffer.from([month,day,hour,minute,second]),u32(microseconds)
]);
const binaryTime=(negative,days,hour,minute,second,microseconds)=>Buffer.concat([
 Buffer.from([12,negative]),u32(days),Buffer.from([hour,minute,second]),u32(microseconds)
]);
test('binary temporal precision never silently discards nonzero microseconds',()=>{
 for(const type of [T.DATETIME,T.TIMESTAMP,T.TIME]){
  const encode=microseconds=>type===T.TIME?binaryTime(0,0,1,2,3,microseconds):
    binaryDatetime(2024,2,29,1,2,3,microseconds);
  const prefix=type===T.TIME?'01:02:03':'2024-02-29 01:02:03';
  for(let precision=0;precision<=6;precision++){
   const column=col('value',type,{decimals:precision});
   const digits='123456'.slice(0,precision);
   const microseconds=Number(digits.padEnd(6,'0'));
   const expected=prefix+(precision?'.'+digits:'');
   assert.deepEqual(binaryValues(wireRow([column],[encode(microseconds)]),[column]),[expected]);
   assert.deepEqual(textValues(bytes(expected),[column]),[expected]);
   if(precision<6)
    assert.throws(()=>binaryValues(wireRow([column],[encode(microseconds+1)]),[column]),
     e=>e.code==='PROTOCOL_ERROR'&&/declared precision/.test(e.message));
  }
  const unknown=col('value',type,{decimals:31});
  assert.deepEqual(binaryValues(wireRow([unknown],[encode(123456)]),[unknown]),[prefix+'.123456']);
  assert.throws(()=>binaryValues(wireRow([unknown],[encode(1000000)]),[unknown]),/fractional seconds/);
 }
});
test('temporal component bounds agree without imposing calendar validity or timezone',()=>{
 const valid=[
  [T.DATE,binaryDate(0,0,0),'0000-00-00'],
  [T.DATE,binaryDate(2024,0,15),'2024-00-15'],
  [T.DATE,binaryDate(2024,2,31),'2024-02-31'],
  [T.DATE,binaryDate(9999,12,31),'9999-12-31'],
  [T.DATETIME,binaryDatetime(2024,4,31,23,59,59,123456),'2024-04-31 23:59:59.123456'],
  [T.TIME,binaryTime(1,34,22,59,59,0),'-838:59:59.000000'],
  [T.TIME,binaryTime(0,0,0,0,0,1),'00:00:00.000001']
 ];
 for(const [type,raw,value] of valid){
  const column=col('value',type,{decimals:6});
  assert.deepEqual(binaryValues(wireRow([column],[raw]),[column]),[value]);
  assert.deepEqual(textValues(bytes(value),[column]),[value]);
 }
 const invalid=[
  [T.DATE,binaryDate(10000,1,1),'10000-01-01'],
  [T.DATE,binaryDate(2024,13,1),'2024-13-01'],
  [T.DATE,binaryDate(2024,1,32),'2024-01-32'],
  [T.DATETIME,binaryDatetime(2024,1,1,24,0,0,0),'2024-01-01 24:00:00'],
  [T.TIMESTAMP,binaryDatetime(2024,1,1,0,60,0,0),'2024-01-01 00:60:00'],
  [T.TIME,binaryTime(0,34,23,0,0,0),'839:00:00'],
  [T.TIME,binaryTime(1,0,1,60,0,0),'-01:60:00'],
  [T.TIME,binaryTime(0,0,1,0,60,0),'01:00:60']
 ];
 for(const [type,raw,value] of invalid){
  const column=col('value',type,{decimals:6});
  assert.throws(()=>binaryValues(wireRow([column],[raw]),[column]));
  assert.throws(()=>textValues(bytes(value),[column]),e=>e.code==='PROTOCOL_ERROR');
 }
 for(const [type,value] of [[T.DATE,'2024-01-01'],[T.TIME,'01:02:03'],[T.DATETIME,'2024-01-01 01:02:03']]){
  for(const tail of ['\n','\r','\r\n','\0',' '])
   assert.throws(()=>textValues(bytes(value+tail),[col('value',type)]),e=>e.code==='PROTOCOL_ERROR');
 }
});
