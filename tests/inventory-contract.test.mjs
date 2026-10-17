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

test('native protocol refuses remote cleartext even if internal adapter is invoked directly',async()=>{
 const {NativePgClient}=await import('../packages/driver/dist/postgresql/wire.js');
 const cfg={host:'example.org',port:5432,user:'test',database:'postgres',password:'ascii-only',
  ssl:false,connectionTimeoutMillis:1000,query_timeout:1000,statement_timeout:1000,application_name:'test'};
 const client=new NativePgClient(cfg);
 await assert.rejects(client.connect(),e=>e.code==='ERR_TLS_CERT_ALTNAME_INVALID');
});
test('native protocol binds the verified TLS identity to the requested target host',async()=>{
 const {NativePgClient}=await import('../packages/driver/dist/postgresql/wire.js');
 const cfg={host:'127.0.0.1',port:5432,user:'test',database:'postgres',password:'ascii-only',
  ssl:{rejectUnauthorized:true,servername:'wrong.internal'},connectionTimeoutMillis:1000,query_timeout:1000,
  statement_timeout:1000,application_name:'test'};
 await assert.rejects(new NativePgClient(cfg).connect(),e=>e.code==='NUBLOX_TLS_REQUIRED');
});
test('native runtime has no third-party DB driver imports',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile('packages/driver/src/postgresql/wire.ts','utf8');
 const pkg=JSON.parse(await readFile('packages/driver/package.json','utf8'));
 assert.equal(Object.keys(pkg.dependencies??{}).length,0);
 assert.doesNotMatch(source,/from ['"](pg|mysql2|tedious)['"]/);
});
