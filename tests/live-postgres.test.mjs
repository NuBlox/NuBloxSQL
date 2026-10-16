import {test} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {inspectDatabase,InspectionError} from '../packages/driver/dist/index.js';

const adminPassword=process.env.NUBLOXSQL_CI_ADMIN_PASSWORD;
if(!adminPassword) throw new Error('Live tests require a disposable PostgreSQL CI service.');
const base={alias:'local-ci',engineId:'postgresql',host:'127.0.0.1',port:5432,
database:'postgres',user:'nublox_reader',password:'test-disposable-only',security:'isolated-local'};

test('live PostgreSQL 17 inspection filters CONNECT-inaccessible databases',async()=>{
 const admin=new pg.Client({host:'127.0.0.1',user:'postgres',database:'postgres',password:adminPassword});
 await admin.connect();
 try {
  await admin.query("CREATE ROLE nublox_reader LOGIN PASSWORD 'test-disposable-only'");
  await admin.query('CREATE DATABASE nublox_visible');
  await admin.query('CREATE DATABASE nublox_hidden');
  await admin.query('REVOKE CONNECT ON DATABASE nublox_hidden FROM PUBLIC');
  await admin.query('GRANT CONNECT ON DATABASE postgres TO nublox_reader');
  await admin.query('GRANT CONNECT ON DATABASE nublox_visible TO nublox_reader');
 } finally {await admin.end();}
 const result=await inspectDatabase(base,{maxDatabases:100,timeoutMs:10000});
 assert.equal(result.schemaVersion,'1.0.0');
 assert.equal(result.operation,'database.inspect');
 assert.equal(result.status,'completed');
 assert.equal(result.target.engineId,'postgresql');
 assert.equal(result.target.currentDatabase,'postgres');
 assert.equal(result.target.currentPrincipal,'nublox_reader');
 assert.equal(Math.floor(result.target.serverVersionNumber/10000),17);
 assert.equal(result.capture.visibilityRule,'connect-privilege-and-datallowconn');
 assert.equal(result.capture.truncated,false);
 assert.ok(result.databases.some(x=>x.name==='nublox_visible'));
 assert.ok(!result.databases.some(x=>x.name==='nublox_hidden'));
 assert.ok(!result.databases.some(x=>x.name==='template0'));
 assert.deepEqual(result.databases.map(x=>x.name),result.databases.map(x=>x.name).sort());
 assert.equal(JSON.stringify(result).includes(adminPassword),false);
 const limited=await inspectDatabase(base,{maxDatabases:1,timeoutMs:10000});
 assert.equal(limited.status,'partial');
 assert.equal(limited.capture.truncated,true);
 assert.equal(limited.databases.length,1);
 assert.equal(limited.warnings[0].code,'RESULT_LIMIT');
 await assert.rejects(inspectDatabase({...base,password:'wrong-test-password'}),e=>e instanceof InspectionError&&e.code==='AUTH_FAILED'&&!e.message.includes('wrong-test-password'));
});
