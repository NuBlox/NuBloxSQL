import test from 'node:test';
import assert from 'node:assert/strict';
import {Cursor} from '../dist/vendors/mysql/protocol/primitives.js';

test('fixed-width and length-coded fields decode without allocating buffer views',()=>{
  const packet=Buffer.from('ab3412efcdab89fffffffffffffffffafbfcfb00fd000001feffffffffffff1f00','hex');
  packet.subarray=()=>assert.fail('scalar read allocated a Buffer view');
  const c=new Cursor(packet);
  assert.equal(c.byte(),0xab);
  assert.equal(c.two(),0x1234);
  assert.equal(c.four(),0x89abcdef);
  assert.equal(c.eight(),0xffffffffffffffffn);
  assert.equal(c.len(),250);
  assert.equal(c.len(),null);
  assert.equal(c.len(),251);
  assert.equal(c.len(),65536);
  assert.equal(c.len(),Number.MAX_SAFE_INTEGER);
  assert.equal(c.remaining(),0);
});

test('every truncated scalar and length prefix fails at the field boundary',()=>{
  for(const [method,width] of [['byte',1],['two',2],['four',4],['eight',8]]){
    for(let n=0;n<width;n++){
      const c=new Cursor(Buffer.alloc(n+1));
      c.byte();
      assert.throws(()=>c[method](),{message:'Malformed MySQL packet'});
      assert.equal(c.p,1);
    }
  }
  for(const [prefix,width] of [[252,2],[253,3],[254,8]]){
    for(let n=0;n<width;n++){
      const c=new Cursor(Buffer.concat([Buffer.from([prefix]),Buffer.alloc(n)]));
      assert.throws(()=>c.len(),{message:'Malformed MySQL packet'});
      assert.equal(c.p,1);
    }
  }
  assert.throws(()=>new Cursor(Buffer.from([255])).len(),{message:'Invalid encoded length'});
  assert.throws(()=>new Cursor(Buffer.from('fe0000000000002000','hex')).len(),{message:'Overlarge length'});
});

test('length-coded payloads retain zero-copy and NULL semantics',()=>{
  const packet=Buffer.from([3,65,66,67,0,251,2,68,69]);
  const c=new Cursor(packet);
  const value=c.lbytes();
  assert.deepEqual(value,Buffer.from('ABC'));
  value[0]=90;
  assert.equal(packet[1],90);
  assert.deepEqual(c.lbytes(),Buffer.alloc(0));
  assert.equal(c.lbytes(),null);
  assert.equal(c.lstr(),'DE');
  assert.equal(c.remaining(),0);
  const truncated=new Cursor(Buffer.from([3,65,66]));
  assert.throws(()=>truncated.lbytes(),{message:'Malformed MySQL packet'});
  assert.equal(truncated.p,1);
});
