import {test} from 'node:test';
import assert from 'node:assert/strict';
import {F} from '../dist/vendors/mysql/protocol/primitives.js';
import {flags} from '../dist/vendors/mysql/protocol/handshake.js';
import {ok,assertSingleResult} from '../dist/vendors/mysql/protocol/results.js';
import {MAX_RESULT_SETS,MAX_RESULT_ROWS,MAX_PACKET_BYTES} from '../dist/core/resources.js';

test('prepared CALL multi-result flags are negotiated without unsafe multi-statements',()=>{
 const server=0xffffffff;
 const selected=flags(server,false,'nublox_test');
 assert.ok(selected&F.PS_MULTI_RESULTS);
 assert.ok(selected&F.MULTI_RESULTS);
 assert.equal(selected&0x10000,0,'CLIENT_MULTI_STATEMENTS must remain disabled');
 assert.throws(()=>flags(server&~F.PS_MULTI_RESULTS,false),/required capabilities/);
});

test('multi-result OK parser admits SERVER_MORE_RESULTS only with explicit opt-in',()=>{
 const more=Buffer.from([0,0,0,8,0,0,0]);
 assert.throws(()=>ok(more),e=>e.code==='UNSUPPORTED_FEATURE');
 assert.equal(ok(more,true).status,8);
 const final=Buffer.from([0,0,0,2,0,0,0]);
 assert.equal(ok(final,true).status,2);
 assert.doesNotThrow(()=>assertSingleResult(2));
 assert.throws(()=>assertSingleResult(8),e=>e.code==='UNSUPPORTED_FEATURE');
});

test('combined multi-result caps are explicit and cannot be silently disabled',()=>{
 assert.equal(MAX_RESULT_SETS,32);
 assert.equal(MAX_RESULT_ROWS,10_000);
 assert.equal(MAX_PACKET_BYTES,32*1024*1024);
});
