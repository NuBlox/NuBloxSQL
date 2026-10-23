import {test} from 'node:test';
import assert from 'node:assert/strict';
import {T,sized,LIMIT} from '../dist/vendors/mysql/protocol/primitives.js';
import {token} from '../dist/vendors/mysql/auth/plugins.js';
import {execute,valuePacket} from '../dist/vendors/mysql/protocol/commands.js';
import {binaryRow} from '../dist/vendors/mysql/types.js';
import {connectDatabase} from '../dist/index.js';
import {PacketStream} from '../dist/vendors/mysql/protocol/framing.js';
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
 reader.reset();socket.write(Buffer.from([1,0,0,3,89]));await assert.rejects(reader.read(),error=>error.code==='PROTOCOL_ERROR');reader.destroy();
});
test('inbound logical messages enforce an aggregate byte cap across frames',async()=>{
 const socket=new PassThrough(),reader=new PacketStream(socket);
 const max=0xffffff;
 const header=(size,seq)=>Buffer.from([size&255,(size>>>8)&255,(size>>>16)&255,seq]);
 socket.write(header(max,0));
 socket.write(Buffer.alloc(max));
 socket.write(header(max,1));
 socket.write(Buffer.alloc(max));
 socket.write(header(10,2));
 socket.write(Buffer.alloc(10));
 await assert.rejects(reader.read(),/limit/);
 reader.destroy();
});

test('packet stream accepts coalesced messages but rejects unsafe queued traffic',async()=>{
 const socket=new PassThrough(),stream=new PacketStream(socket);
 // Two valid frames in one TCP write have distinct sequence numbers.
 socket.write(Buffer.from([1,0,0,0,65,1,0,0,1,66]));
 assert.deepEqual(await stream.read(),Buffer.from('A'));
 assert.deepEqual(await stream.read(),Buffer.from('B'));
 stream.reset();

 // A queued response must be consumed before a command boundary is reset.
 socket.write(Buffer.from([1,0,0,0,67]));
 assert.throws(()=>stream.reset(),/unread/);
 assert.deepEqual(await stream.read(),Buffer.from('C'));
 stream.reset();

 // Many individually valid frames may still exceed the aggregate input budget.
 const chunk=Buffer.alloc(11*1024*1024);
 const encode=(body,seq)=>Buffer.concat([Buffer.from([body.length&255,(body.length>>8)&255,(body.length>>16)&255,seq]),body]);
 socket.write(encode(chunk,0));
 socket.write(encode(chunk,1));
 socket.write(encode(chunk,2));
 socket.write(encode(Buffer.from([42]),3));
 await assert.rejects(stream.read(),/limit/);
 await assert.rejects(stream.read(),/limit/);
 stream.destroy();
});
