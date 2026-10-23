import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {PassThrough} from 'node:stream';
import {PacketStream} from '../dist/vendors/mysql/protocol/framing.js';

test('idle transport EOF notifies the owner even when no read is pending',async()=>{
 const socket=new PassThrough();
 const stream=new PacketStream(socket);
 const failures=[];
 stream.onFatal(error=>failures.push(error));
 const closed=once(socket,'close');
 socket.end();
 await closed;
 assert.equal(failures.length,1);
 assert.match(failures[0].message,/closed/);
 await assert.rejects(stream.read(),/closed/);
 assert.throws(()=>stream.reset(),/closed/);
 stream.destroy();
 assert.equal(failures.length,1,'fatal callback fires only once');
});

test('mid-header socket close rejects read and preserves fatal cause',async()=>{
 const socket=new PassThrough();
 const stream=new PacketStream(socket);
 const seen=[];
 stream.onFatal(error=>seen.push(error.message));
 const waiting=stream.read();
 socket.write(Buffer.from([5,0]));
 const closed=once(socket,'close');
 socket.destroy();
 await closed;
 await assert.rejects(waiting,/closed/);
 assert.deepEqual(seen,['Database connection closed']);
});

test('wrong packet sequence invalidates read and later operations without reuse',async()=>{
 const socket=new PassThrough();
 const stream=new PacketStream(socket);
 let fatal=0;
 stream.onFatal(()=>fatal++);
 const waiting=stream.read();
 socket.write(Buffer.from([1,0,0,5,0x11]));
 await assert.rejects(waiting,/sequence mismatch/);
 assert.equal(fatal,1);
 await assert.rejects(stream.send(Buffer.from([1])),/sequence mismatch/);
 await assert.rejects(stream.read(),/sequence mismatch/);
 stream.destroy();
});

test('fatal subscription added after failure is synchronously informed',async()=>{
 const socket=new PassThrough();
 const stream=new PacketStream(socket);
 stream.abort(new Error('injected corrupt packet'));
 let observed;
 stream.onFatal(error=>{observed=error.message;});
 assert.equal(observed,'injected corrupt packet');
 stream.destroy();
});

test('detaching for TLS removes old socket listeners without signalling failure',()=>{
 const underlying=new PassThrough();
 const encrypted=new PassThrough();
 const stream=new PacketStream(underlying);
 let failures=0;
 stream.onFatal(()=>failures++);
 stream.attach(encrypted);
 underlying.destroy();
 assert.equal(failures,0);
 stream.destroy();
 assert.equal(failures,1);
});
