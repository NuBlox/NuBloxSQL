import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execute,valuePacket} from '../dist/vendors/mysql/protocol/commands.js';
import {u32,LIMIT,T} from '../dist/vendors/mysql/protocol/primitives.js';
import {MAX_PARAMETERS} from '../dist/core/resources.js';

/** Independent copy of the pre-optimisation encoder to prove byte-for-byte
 * compatibility, including type flags, bitmaps and length-coded payloads. */
function legacyExecute(id,params,cursor=false){
  if(params.length>MAX_PARAMETERS)throw RangeError('Too many parameters');
  const values=params.map(valuePacket);
  const header=Buffer.concat([
    Buffer.from([0x17]),u32(id),Buffer.from([cursor?1:0]),u32(1)
  ]);
  if(!values.length)return header;
  const nulls=Buffer.alloc(Math.ceil(values.length/8));
  values.forEach((v,i)=>{
    if(v.nil)nulls[i>>3]|=1<<(i%8);
  });
  const packet=Buffer.concat([
    header,nulls,Buffer.from([1]),
    ...values.map(v=>Buffer.from([v.type,v.flag])),
    ...values.filter(v=>!v.nil).map(v=>v.body)
  ]);
  if(packet.length>LIMIT)throw RangeError('Command exceeds limit');
  return packet;
}

const candidates=[
  null,true,false,'','ascii','é漢字🚀','a'.repeat(252),
  new Uint8Array([]),Uint8Array.from([0,1,2,127,255]),
  Buffer.from([0,0xff,0x80,0x00]),
  0,-0,1,-1,127,-127,255,256,32767,65535,
  Number.MAX_SAFE_INTEGER,Number.MIN_SAFE_INTEGER,
  1.125,-0.0625,2.5e-90,-2.3e-40,
  0n,-1n,-(2n**63n),2n**63n-1n,2n**63n,2n**64n-1n
];
test('single allocation encodes exact original Classic protocol bytes across types and cursor flags',()=>{
  for(const id of [0,1,0x12345678,0xffffffff]){
    for(const cursor of [false,true]){
      for(const value of candidates){
        const actual=execute(id,[value],cursor);
        const reference=legacyExecute(id,[value],cursor);
        assert.deepEqual(actual,reference,typeof value+' '+String(value));
        assert.equal(actual[0],0x17);
        assert.equal(actual.readUInt32LE(1),id);
        assert.equal(actual[5],Number(cursor));
        assert.equal(actual.readUInt32LE(6),1);
      }
      assert.deepEqual(execute(id,[],cursor),legacyExecute(id,[],cursor));
    }
  }
});
test('multiple parameters preserve null bitmap across bytes and type order',()=>{
  const inputs=[
    [null,null,null,null,null,null,null,null,null],
    Array.from({length:64},(_,i)=>i%7===0?null:i%3===0?'多言語':
      i%3===1?BigInt(i):new Uint8Array([i,0,255])),
    candidates.slice(0,14),
    Array.from({length:MAX_PARAMETERS},(_,i)=>i%2?null:i)
  ];
  for(const values of inputs){
    for(const cursor of [false,true]){
      const actual=execute(0x70000002,values,cursor);
      assert.deepEqual(actual,legacyExecute(0x70000002,values,cursor));
      assert.equal(actual.length,legacyExecute(0x70000002,values,cursor).length);
    }
  }
  const one=execute(1,[null]);
  assert.equal(one[10],1); // bit 0 is NULL
  assert.equal(one[11],1); // new bound values
  assert.equal(one[12],T.NULL);
  assert.equal(one[13],0);
});
test('seeded variable-length packets cannot differ at any byte',()=>{
  let state=0x4e425851;
  const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
  for(let round=0;round<750;round++){
    const params=Array.from({length:next()%(MAX_PARAMETERS+1)},()=>{
      const pick=next()%9;
      if(pick===0)return null;
      if(pick===1)return Boolean(next()&1);
      if(pick===2)return String(next())+'ø';
      if(pick===3)return Number(next()%1000)+0.125;
      if(pick===4)return BigInt(next())-(2n**31n);
      if(pick===5)return Uint8Array.from({length:next()%128},()=>next()%256);
      if(pick===6)return -Number(next()%1_000_000);
      if(pick===7)return '';
      return 'Ω'.repeat(next()%100);
    });
    const id=next(),cursor=Boolean(next()&1);
    assert.deepEqual(execute(id,params,cursor),legacyExecute(id,params,cursor),
      'wire mismatch round '+round);
  }
});
test('invalid bindings and parameter ceiling fail as before without emitting a wire packet',()=>{
  const invalid=[NaN,Infinity,-Infinity,Number.MAX_SAFE_INTEGER+1,
    Number.MIN_SAFE_INTEGER-1,2n**64n,-(2n**63n)-1n,
    {},[],new Date(),undefined];
  for(const value of invalid){
    assert.throws(()=>execute(12,[value]));
    assert.throws(()=>legacyExecute(12,[value]));
  }
  const tooMany=Array.from({length:MAX_PARAMETERS+1},()=>null);
  assert.throws(()=>execute(0,tooMany),/Too many parameters/);
  assert.deepEqual(execute(42,[],true),Buffer.from([
    0x17,42,0,0,0,1,1,0,0,0
  ]));
});
