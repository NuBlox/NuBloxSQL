import {test} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {spawnSync} from 'node:child_process';
import {mkdtemp, readFile, stat, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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

 const dir=await mkdtemp(join(tmpdir(),'nubloxsql-live-'));
 const destination=join(dir,'inventory.json');
 const env={...process.env,NUBLOXSQL_PROFILE_ALIAS:'local-ci',
  NUBLOXSQL_PG_HOST:'127.0.0.1',NUBLOXSQL_PG_PORT:'5432',
  NUBLOXSQL_PG_USER:base.user,NUBLOXSQL_PG_PASSWORD:base.password,
  NUBLOXSQL_PG_DATABASE:base.database,NUBLOXSQL_PG_SECURITY:'isolated-local'};
 try {
  const cli=spawnSync(process.execPath,['apps/shell/dist/cli.js','shell','inspect',
   '--profile','local-ci','--format','json','--output',destination],{encoding:'utf8',env});
  assert.equal(cli.status,0,cli.stderr);
  const shellResult=JSON.parse(await readFile(destination,'utf8'));
  const withoutTime=({capture,...rest})=>({...rest,capture:{...capture,capturedAt:'ignored'}});
  assert.deepEqual(withoutTime(shellResult),withoutTime(result));
  assert.equal((await stat(destination)).mode & 0o777,0o600);
  const collision=spawnSync(process.execPath,['apps/shell/dist/cli.js','shell','inspect',
   '--profile','local-ci','--format','json','--output',destination],{encoding:'utf8',env});
  assert.equal(collision.status,1);
  assert.match(collision.stderr,/OUTPUT_FAILED/);
  assert.deepEqual(JSON.parse(await readFile(destination,'utf8')),shellResult);
 } finally {
  await rm(dir,{recursive:true,force:true});
 }
});
