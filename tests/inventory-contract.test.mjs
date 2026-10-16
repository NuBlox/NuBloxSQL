import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectDatabase, InspectionError} from '../packages/driver/dist/index.js';

const local={alias:'local-test',engineId:'postgresql',host:'127.0.0.1',
 port:5432,user:'nobody',database:'postgres',password:'disposable-only',security:'isolated-local'};

test('unsupported engines do not masquerade as supported adapters',async()=>{
 await assert.rejects(inspectDatabase({...local,engineId:'mysql'}),e=>e instanceof InspectionError&&e.code==='UNSUPPORTED_ENGINE');
});
test('remote cleartext and invalid security are refused before networking',async()=>{
 await assert.rejects(inspectDatabase({...local,host:'example.org'}),e=>e.code==='TLS_UNVERIFIED');
 await assert.rejects(inspectDatabase({...local,security:'unverified'}),e=>e.code==='TLS_UNVERIFIED');
});
test('unexpected connection-string options are refused',async()=>{
 await assert.rejects(inspectDatabase({...local,connectionString:'postgres://admin:secret@bad.invalid/db'}),e=>e.code==='INVALID_INPUT');
});
test('unsafe aliases, database limits and timeouts fail without networking',async()=>{
 await assert.rejects(inspectDatabase({...local,alias:'not a safe alias'}),e=>e.code==='INVALID_INPUT');
 await assert.rejects(inspectDatabase(local,{maxDatabases:1001}),e=>e.code==='INVALID_INPUT');
 await assert.rejects(inspectDatabase(local,{timeoutMs:10}),e=>e.code==='INVALID_INPUT');
});
test('safe structured errors do not serialize native secrets',()=>{
 const e=new InspectionError('AUTH_FAILED','Database authentication failed.');
 assert.deepEqual(e.toJSON(),{schemaVersion:'1.0.0',operation:'database.inspect',code:'AUTH_FAILED',message:'Database authentication failed.',retryable:false});
 assert.equal(JSON.stringify(e).includes('password'),false);
});
