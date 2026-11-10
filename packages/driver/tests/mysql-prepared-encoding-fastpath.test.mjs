import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execute,valuePacket,validateExecuteParameters} from '../dist/vendors/mysql/protocol/commands.js';
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
test('oversized prepared binds fail before any large UTF-8/BLOB allocation',()=>{
  const overLimitText='x'.repeat(LIMIT);
  const tooLargeBinary=Buffer.alloc(LIMIT);
  const reusableBinary=Buffer.alloc(12*1024*1024,0x61);
  // Track the exact oversized payload sources: rejection must happen at the
  // sizing stage, before Buffer.from copies any of these buffers/strings.
  const original=Buffer.from;
  let copied=0;
  Buffer.from=function(input,...rest){
    if(input===overLimitText||input===tooLargeBinary||input===reusableBinary)
      copied++;
    return original.call(Buffer,input,...rest);
  };
  try{
    assert.throws(()=>valuePacket(overLimitText),/parameter exceeds/);
    assert.throws(()=>valuePacket(tooLargeBinary),/parameter exceeds/);
    assert.throws(()=>execute(44,[overLimitText]),/parameter exceeds/);
    assert.throws(()=>execute(44,[tooLargeBinary]),/parameter exceeds/);
    // Each BLOB fits alone, but three cannot fit in one 32 MiB COM_STMT_EXECUTE.
    assert.throws(()=>execute(44,[reusableBinary,reusableBinary,reusableBinary]),
      /Command exceeds limit/);
    assert.equal(copied,0,'no rejected BLOB or text may be copied during preflight');
  }finally{
    Buffer.from=original;
  }
});

test('prepared command limit includes parameter flags, null bitmap and length prefixes',()=>{
  // Near the boundary one BLOB is valid only if its complete command frame
  // (fixed header + null bitmap/type flags + 9-byte size prefix) fits.
  const overhead=10+1+1+2+9;
  const allowed=Buffer.alloc(LIMIT-overhead,0x51);
  const encoded=execute(100,[allowed]);
  assert.equal(encoded.length,LIMIT);
  assert.equal(encoded[0],0x17);
  assert.equal(encoded[10],0,'non-NULL BLOB has a zeroed NULL bitmap');
  assert.equal(encoded[11],1,'parameter type markers are required');
  assert.equal(encoded[12],T.BLOB);
  assert.equal(encoded[13],0);
  assert.equal(encoded[14],254,'large BLOB uses the 9-byte length prefix');
  assert.equal(encoded.readBigUInt64LE(15),BigInt(allowed.length));
  assert.equal(encoded.at(-1),0x51);
  assert.throws(()=>execute(100,[Buffer.alloc(LIMIT-overhead+1)]),
    /Command exceeds limit/);
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

test('hot path writes text and sliced binary directly without temporary Buffer factories',()=>{
  const backing=Uint8Array.from([99,98,0,255,1,2,3,97]);
  const view=backing.subarray(2,7);
  const mixed=[null,'é漢字🚀',view,true,-24n,18446744073709551615n,1.125];
  const expected=legacyExecute(0xdeadbeef,mixed);
  const from=Buffer.from,concat=Buffer.concat;
  let factories=0;
  Buffer.from=function(){factories++;throw Error('Unexpected temporary Buffer.from');};
  Buffer.concat=function(){factories++;throw Error('Unexpected temporary Buffer.concat');};
  try{
    assert.deepEqual(execute(0xdeadbeef,mixed),expected);
    assert.equal(factories,0,'encoding must write directly into the final command');
  }finally{
    Buffer.from=from;
    Buffer.concat=concat;
  }
  // A caller-owned subarray encodes only its visible bytes.
  assert.deepEqual(execute(9,[view]),legacyExecute(9,[view]));
});

test('prepared encoder preserves every length-prefix transition',()=>{
  const lengths=[0,1,250,251,252,65535,65536,0xffffff,0x1000000];
  for(const bytes of lengths){
    const blob=Buffer.alloc(bytes,0xa6);
    const encoded=execute(25,[blob]);
    const reference=legacyExecute(25,[blob]);
    assert.deepEqual(encoded,reference,'wire bytes differ at length '+bytes);
  }
});

test('invalid later binds do not allocate the outgoing command',()=>{
  const original=Buffer.allocUnsafe;
  let allocations=0;
  Buffer.allocUnsafe=function(...args){allocations++;return original.apply(Buffer,args);};
  try{
    assert.throws(()=>execute(41,['valid',Number.POSITIVE_INFINITY]),TypeError);
    assert.throws(()=>execute(41,[Uint8Array.from([1,2]),'\ud800']),TypeError);
    assert.throws(()=>execute(41,[Buffer.alloc(1),BigInt('18446744073709551616')]),RangeError);
    assert.equal(allocations,0,'invalid input must fail before final packet allocation');
  }finally{
    Buffer.allocUnsafe=original;
  }
});


test('allocation-free bind preflight matches execute wire size and validity',()=>{
  const cases=[
    [],[null],[true,false,0,-1,1.5,3n],
    ['é漢字🚀',new Uint8Array([0,1,255]),2n**63n],
    Array.from({length:MAX_PARAMETERS},(_,i)=>i%2?null:i)
  ];
  for(const params of cases)
    assert.equal(validateExecuteParameters(params),execute(17,params).length);
  const bad=[NaN,Infinity,Number.MAX_SAFE_INTEGER+1,
    '\ud800',{},new Date(),undefined];
  for(const value of bad)
    assert.throws(()=>validateExecuteParameters([value]),TypeError);
  assert.throws(()=>validateExecuteParameters([-(2n**63n)-1n]),RangeError);
  assert.throws(()=>validateExecuteParameters([2n**64n]),RangeError);
  assert.throws(()=>validateExecuteParameters(
    Array.from({length:MAX_PARAMETERS+1},()=>null)),RangeError);
  assert.throws(()=>validateExecuteParameters(null),TypeError);
  assert.throws(()=>validateExecuteParameters({length:0}),TypeError);
});

test('cache-miss bind preflight never allocates a packet for invalid input',()=>{
  const large=new Uint8Array(12*1024*1024);
  const original=Buffer.allocUnsafe;
  let allocations=0;
  Buffer.allocUnsafe=function(...args){allocations++;return original.apply(Buffer,args);};
  try{
    assert.throws(()=>validateExecuteParameters([large,large,large]),
      /Command exceeds limit/);
    assert.throws(()=>validateExecuteParameters(['valid',Infinity]),TypeError);
    assert.equal(allocations,0,'no final COM_STMT_EXECUTE allocation during preflight');
  }finally{
    Buffer.allocUnsafe=original;
  }
});
