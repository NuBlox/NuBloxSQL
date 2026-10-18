import {test} from 'node:test';
import assert from 'node:assert/strict';
import {T,sized,token,execute,valuePacket,LIMIT} from '../src/internal/codec.js';
import {binaryRow} from '../src/internal/rows.js';
import {connectDatabase} from '../src/index.js';
import {PacketStream} from '../src/internal/transport.js';
import {PassThrough} from 'node:stream';

test('reject unknown engine and unsafe plaintext outside loopback',async()=>{
 await assert.rejects(connectDatabase({engine:'postgresql'}),e=>e.code==='UNSUPPORTED_ENGINE');
 await assert.rejects(connectDatabase({engine:'mysql',host:'database.example',port:3306,user:'a',password:'b',security:'isolated-local'}),e=>e.code==='INVALID_INPUT');
});
test('challenge responses support caching SHA-2 without exposing password',()=>{
 const salt=Buffer.alloc(20,5);assert.equal(token('s3cr3t',salt,'caching_sha2_password').length,32);
 assert.equal(token('s3cr3t',salt,'mysql_native_password').length,20);
 assert.notDeepEqual(token('s3cr3t',salt,'caching_sha2_password'),token('wrong',salt,'caching_sha2_password'));
 assert.throws(()=>token('x',salt,'unknown'));
});
test('server-prepared values retain types and do not rewrite SQL',()=>{
 const packet=execute(33,["' OR 1=1 --",null,1,18446744073709551615n,Buffer.from([0,255])]);
 assert.equal(packet[0],0x17);assert.equal(packet.readUInt32LE(1),33);assert.equal(packet[10]&2,2);
 assert.ok(packet.includes(Buffer.from("' OR 1=1 --")));assert.equal(valuePacket(-42n).body.readBigInt64LE(),-42n);
 assert.throws(()=>valuePacket(Number.MAX_SAFE_INTEGER+1),/large integers/);
 assert.throws(()=>valuePacket(Infinity));
});
test('binary protocol retains high-precision decimals, unsigned 64-bit and binary data',()=>{
 const cols=[{name:'amount',type:T.NEWDECIMAL,charset:45},{name:'large',type:T.LONGLONG,unsigned:true},{name:'bytes',type:T.BLOB,charset:63},{name:'none',type:T.VAR_STRING,charset:45}];
 const n=Buffer.alloc(8);n.writeBigUInt64LE(18446744073709551615n);
 const data=Buffer.concat([Buffer.from([0,32]),sized(Buffer.from('123456789.123456789')),n,sized(Buffer.from([0,255]))]);
 const row=binaryRow(data,cols);assert.equal(row.amount,'123456789.123456789');
 assert.equal(row.large,18446744073709551615n);assert.deepEqual(row.bytes,Buffer.from([0,255]));
 assert.equal(row.none,null);
});
test('packet reader supports fragmented frames and detects sequence mismatch',async()=>{
 const socket=new PassThrough(),reader=new PacketStream(socket);
 const p=reader.read();const frame=Buffer.from([2,0,0,0,65,66]);socket.write(frame.subarray(0,2));socket.write(frame.subarray(2));
 assert.deepEqual(await p,Buffer.from('AB'));
 reader.reset();socket.write(Buffer.from([1,0,0,3,89]));await assert.rejects(reader.read(),/sequence mismatch/);reader.destroy();
});
test('inbound packet buffer has an upper bound',async()=>{
 const socket=new PassThrough(),reader=new PacketStream(socket);
 socket.write(Buffer.alloc(LIMIT+5));await assert.rejects(reader.read(),/limit/);reader.destroy();
});
