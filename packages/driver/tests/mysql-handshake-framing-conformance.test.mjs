import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {flags,sslRequest,login} from '../dist/vendors/mysql/protocol/handshake.js';
import {token} from '../dist/vendors/mysql/auth/plugins.js';
import {PacketStream} from '../dist/vendors/mysql/protocol/framing.js';

// Independent fixture values calculated from the published SHA1/SHA256
// challenge formulas (Python hashlib), not another client implementation.
const seed=Buffer.from('000102030405060708090a0b0c0d0e0f10111213','hex');
const password='Café🔑';
const native=Buffer.from('ddfddd42f53f11ca30c0837c575c75433d862a85','hex');
const sha2=Buffer.from('59c4b7972f27fd2cfdc1ce542f95f5836551b7e77c555c9004be0e28601e2a3a','hex');

test('published authentication challenge formulas match independent Unicode known answers',()=>{
  assert.deepEqual(token(password,seed,'mysql_native_password'),native);
  assert.deepEqual(token(password,seed,'caching_sha2_password'),sha2);
  for(const plugin of ['mysql_native_password','caching_sha2_password'])
    assert.deepEqual(token('',seed,plugin),Buffer.alloc(0));
});

test('Classic 4.1 SSLRequest and login match exact independently constructed wire bytes',()=>{
  const supported=0xffffffff;
  const localFlags=flags(supported,false);
  const tlsFlags=flags(supported,true,'db');
  assert.equal(localFlags,0x000ea205);
  assert.equal(tlsFlags,0x000eaa0d);
  // 32 bytes: flags, 32 MiB maximum, collation 45, zero padding.
  const securePrefix=Buffer.concat([Buffer.from('0daa0e00000000022d','hex'),Buffer.alloc(23)]);
  const localPrefix=Buffer.concat([Buffer.from('05a20e00000000022d','hex'),Buffer.alloc(23)]);
  assert.deepEqual(sslRequest(tlsFlags),securePrefix);
  assert.deepEqual(login({f:tlsFlags,user:'用户',password,database:'db',seed,plugin:'caching_sha2_password'}),
    Buffer.concat([securePrefix,Buffer.from('用户\0','utf8'),Buffer.from([32]),sha2,Buffer.from('db\0caching_sha2_password\0')]));
  assert.deepEqual(login({f:localFlags,user:'u',password:'',seed,plugin:'mysql_native_password'}),
    Buffer.concat([localPrefix,Buffer.from('u\0'),Buffer.from([0]),Buffer.from('mysql_native_password\0')]));
  for(const bit of [1,4,0x200,0x2000,0x8000,0x20000,0x40000,0x80000])
    assert.throws(()=>flags(supported&~bit,false),e=>e.code==='UNSUPPORTED_FEATURE');
  assert.throws(()=>flags(supported&~0x800,true),e=>e.code==='UNSUPPORTED_FEATURE');
  assert.throws(()=>flags(supported&~8,false,'db'),e=>e.code==='UNSUPPORTED_FEATURE');
});

class FixtureSocket extends EventEmitter {
  writes=[];
  destroyed=false;
  write(bytes,callback){this.writes.push(Buffer.from(bytes));callback();return true;}
  destroy(){this.destroyed=true;}
}
test('Classic sequence wraps 255 to zero across both directions and resets at command boundary',async()=>{
  const socket=new FixtureSocket();
  const packets=new PacketStream(socket);
  try{
    for(let i=0;i<255;i++){
      await packets.send(Buffer.from([0x61]));
      assert.deepEqual(socket.writes[i],Buffer.from([1,0,0,i,0x61]));
    }
    const received=packets.read();
    socket.emit('data',Buffer.from([1,0,0,255,0x62]));
    assert.deepEqual(await received,Buffer.from([0x62]));
    await packets.send(Buffer.from([0x63]));
    assert.deepEqual(socket.writes[255],Buffer.from([1,0,0,0,0x63]));
    // After the wrapped client packet, the next server packet must be 1.
    socket.emit('data',Buffer.from([1,0,0,1,0x64]));
    assert.throws(()=>packets.reset(),/unread/);
    assert.deepEqual(await packets.read(),Buffer.from([0x64]));
    packets.reset();
    await packets.send(Buffer.from([0x65]));
    assert.deepEqual(socket.writes[256],Buffer.from([1,0,0,0,0x65]));
  }finally{packets.destroy();}
});
