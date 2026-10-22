import {test} from 'node:test';
import assert from 'node:assert/strict';
import {T,sized,u16,u32} from '../dist/vendors/mysql/protocol/primitives.js';
import {binaryRow} from '../dist/vendors/mysql/types.js';

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
 const signed4=Buffer.alloc(4);signed4.writeInt32LE(-2147483648);
 const row=decode([
  col('bigunsigned',T.LONGLONG,{unsigned:true}),col('bigsigned',T.LONGLONG),
  col('intunsigned',T.LONG,{unsigned:true}),col('intsigned',T.INT24),
  col('year',T.YEAR,{unsigned:true}),col('tinynegative',T.TINY)
 ],[large,negative,u4,signed4,u16(2024),Buffer.from([0x80])]);
 assert.equal(row.bigunsigned,18446744073709551615n);
 assert.equal(row.bigsigned,-9223372036854775808n);
 assert.equal(row.intunsigned,4294967295);
 assert.equal(row.intsigned,-2147483648);
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
