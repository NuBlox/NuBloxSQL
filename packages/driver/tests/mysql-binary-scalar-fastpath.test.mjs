import {test} from 'node:test';
import assert from 'node:assert/strict';
import {binaryValues} from '../dist/vendors/mysql/types.js';
import {T} from '../dist/vendors/mysql/protocol/primitives.js';

const specs=[
  [T.TINY,false,[-128,-1,0,127]],
  [T.TINY,true,[0,1,127,255]],
  [T.SHORT,false,[-32768,-1,0,32767]],
  [T.SHORT,true,[0,1,32768,65535]],
  [T.YEAR,false,[0,1,2024,32767]],
  [T.YEAR,true,[0,1,2024,65535]],
  [T.LONG,false,[-2147483648,-1,0,2147483647]],
  [T.LONG,true,[0,1,2147483648,4294967295]],
  [T.INT24,false,[-2147483648,-1,0,2147483647]],
  [T.INT24,true,[0,1,2147483648,4294967295]],
  [T.LONGLONG,false,[-(2n**63n),-1n,0n,2n**63n-1n]],
  [T.LONGLONG,true,[0n,1n,2n**63n,2n**64n-1n]],
  [T.FLOAT,false,[-1.25,-0,0,3.5]],
  [T.DOUBLE,false,[-1.25,-0,0,3.5]]
];
const size=type=>type===T.TINY?1:
  type===T.SHORT||type===T.YEAR?2:
  type===T.LONG||type===T.INT24||type===T.FLOAT?4:8;
const col=(type,unsigned,index)=>({
  name:'scalar_'+index,type,unsigned,charset:63,length:64,flags:unsigned?32:0,
  decimals:0,schema:null,table:null,originalName:null,originalTable:null
});
function encode(type,unsigned,value){
  const out=Buffer.alloc(size(type));
  if(type===T.TINY)unsigned?out.writeUInt8(value):out.writeInt8(value);
  else if(type===T.SHORT||type===T.YEAR)
    unsigned?out.writeUInt16LE(value):out.writeInt16LE(value);
  else if(type===T.LONG||type===T.INT24)
    unsigned?out.writeUInt32LE(value):out.writeInt32LE(value);
  else if(type===T.LONGLONG)
    unsigned?out.writeBigUInt64LE(value):out.writeBigInt64LE(value);
  else if(type===T.FLOAT)out.writeFloatLE(value);
  else out.writeDoubleLE(value);
  return out;
}
function scalarPacket(columns,rawValues){
  const bitmap=Buffer.alloc(Math.ceil((columns.length+2)/8));
  const body=[];
  for(let i=0;i<columns.length;i++){
    const value=rawValues[i];
    if(value===null)bitmap[(i+2)>>3]|=1<<((i+2)%8);
    else body.push(encode(columns[i].type,columns[i].unsigned,value));
  }
  return Buffer.concat([Buffer.from([0]),bitmap,...body]);
}
// Independent reference reproduces the previous implementation's
// Cursor.take(width).read*LE behaviour; it never imports the candidate decoder.
function reference(packet,columns){
  if(packet[0]!==0)throw Error('Invalid MySQL binary result row');
  let p=1;
  const bitmapBytes=Math.ceil((columns.length+2)/8);
  if(packet.length-p<bitmapBytes)throw Error('Malformed MySQL packet');
  const bitmap=packet.subarray(p,p+bitmapBytes);p+=bitmapBytes;
  const values=[];
  for(let i=0;i<columns.length;i++){
    if(bitmap[(i+2)>>3]&(1<<((i+2)%8))){
      values.push(null);continue;
    }
    const {type,unsigned}=columns[i],bytes=size(type);
    if(packet.length-p<bytes)throw Error('Malformed MySQL packet');
    const view=packet.subarray(p,p+bytes);p+=bytes;
    let value;
    if(type===T.TINY)value=unsigned?view.readUInt8():view.readInt8();
    else if(type===T.SHORT||type===T.YEAR)
      value=unsigned?view.readUInt16LE():view.readInt16LE();
    else if(type===T.LONG||type===T.INT24)
      value=unsigned?view.readUInt32LE():view.readInt32LE();
    else if(type===T.LONGLONG)
      value=unsigned?view.readBigUInt64LE():view.readBigInt64LE();
    else if(type===T.FLOAT)value=view.readFloatLE();
    else value=view.readDoubleLE();
    values.push(value);
  }
  if(p!==packet.length)throw Error('Trailing MySQL binary row bytes');
  return values;
}
test('fixed-size numeric decoder exactly preserves signedness, bigint and floating values',()=>{
  for(const [i,[type,unsigned,values]] of specs.entries()){
    const columns=[col(type,unsigned,i)];
    for(const value of values){
      const packet=scalarPacket(columns,[value]);
      assert.deepEqual(binaryValues(packet,columns),reference(packet,columns),
        'type '+type+' unsigned '+unsigned+' value '+String(value));
    }
  }
});
test('NULL bitmap crossing byte boundaries and interleaved signed/unsigned scalars',()=>{
  const columns=Array.from({length:64},(_,i)=>{
    const [type,unsigned]=specs[i%specs.length];
    return col(type,unsigned,i);
  });
  const values=columns.map((_,i)=>i%5===0?null:
    specs[i%specs.length][2][i%4]);
  const packet=scalarPacket(columns,values);
  assert.deepEqual(binaryValues(packet,columns),reference(packet,columns));
  assert.equal(binaryValues(packet,columns).length,64);
  for(let truncate=0;truncate<packet.length;truncate++){
    assert.throws(()=>binaryValues(packet.subarray(0,truncate),columns),
      /Malformed MySQL packet|Trailing MySQL binary row bytes/);
  }
});
test('deterministic mixed numeric fields never differ from historical slice-based decoder',()=>{
  let seed=0x4e425851;
  const rand=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
  for(let round=0;round<1500;round++){
    const count=1+rand()%48;
    const columns=[],values=[];
    for(let i=0;i<count;i++){
      const [type,unsigned,samples]=specs[rand()%specs.length];
      columns.push(col(type,unsigned,i));
      values.push(rand()%7===0?null:samples[rand()%samples.length]);
    }
    const packet=scalarPacket(columns,values);
    assert.deepEqual(binaryValues(packet,columns),reference(packet,columns),
      'numeric row round '+round);
    // Every truncated numeric cell must be rejected rather than padded.
    if(packet.length>2&&round%11===0)
      assert.throws(()=>binaryValues(packet.subarray(0,packet.length-1),columns));
  }
});
test('trailing data, invalid header and split 64-bit scalars fail closed',()=>{
  const columns=[col(T.LONGLONG,true,0)];
  const full=scalarPacket(columns,[2n**64n-1n]);
  assert.equal(binaryValues(full,columns)[0],2n**64n-1n);
  for(let length=0;length<full.length;length++)
    assert.throws(()=>binaryValues(full.subarray(0,length),columns));
  assert.throws(()=>binaryValues(Buffer.concat([full,Buffer.from([0])]),columns),
    /Trailing MySQL binary row bytes/);
  const invalid=Buffer.from(full);invalid[0]=1;
  assert.throws(()=>binaryValues(invalid,columns),/Invalid MySQL binary result row/);
});
