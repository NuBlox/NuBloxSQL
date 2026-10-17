import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {NativePgClient} from '../packages/driver/dist/postgresql/wire.js';
import {inspectDatabase, InspectionError} from '../packages/driver/dist/index.js';

const caPath=process.env.NUBLOXSQL_CI_TLS_CA_FILE;
const wrongCaPath=process.env.NUBLOXSQL_CI_TLS_UNTRUSTED_CA_FILE;
const adminPassword=process.env.NUBLOXSQL_CI_ADMIN_PASSWORD;
if(!caPath||!wrongCaPath||!adminPassword)throw Error('Live TLS tests require the disposable TLS PostgreSQL 17 fixture');

const ca=await readFile(caPath,'utf8'),wrongCa=await readFile(wrongCaPath,'utf8');
const base={
  alias:'tls-fixture',engineId:'postgresql',host:'127.0.0.1',port:5433,
  database:'postgres',user:'postgres',password:adminPassword,security:'verified-tls',
  caCertificate:ca
};
function client({port=5433,caCertificate=ca,host='127.0.0.1',servername=host}={}){
  return new NativePgClient({
    host,port,user:'postgres',database:'postgres',password:adminPassword,
    ssl:{rejectUnauthorized:true,servername,ca:caCertificate},
    connectionTimeoutMillis:8000,query_timeout:8000,
    statement_timeout:8000,application_name:'nubloxsql-native-verified-tls-ci'
  });
}

test('first-party PostgreSQL SSLRequest performs verified TLS and native SCRAM',async()=>{
  const c=client();
  await c.connect();
  try{
    const r=await c.query('SELECT ssl::text AS encrypted FROM pg_stat_ssl WHERE pid=pg_backend_pid()');
    assert.equal(r.rows[0].encrypted,'true');
    assert.equal((await c.query('SELECT 42 AS answer')).rows[0].answer,'42');
  }finally{await c.end();}
});

test('Driver inspectDatabase works end-to-end over certificate-verified TLS',async()=>{
  const r=await inspectDatabase(base,{timeoutMs:8000});
  assert.equal(r.transportSecurity,'verified-tls');
  assert.equal(r.operation,'database.inspect');
  assert.equal(r.target.currentPrincipal,'postgres');
  assert.ok(r.databases.some(d=>d.name==='postgres'));
});

test('TLS certificate signed by unknown CA is refused without plaintext fallback',async()=>{
  await assert.rejects(inspectDatabase({...base,caCertificate:wrongCa},{timeoutMs:8000}),
    e=>e instanceof InspectionError&&e.code==='TLS_UNVERIFIED'&&!e.message.includes(adminPassword));
});

test('a trusted CA-signed certificate with the wrong hostname is refused',async()=>{
  await assert.rejects(inspectDatabase({...base,port:5434},{timeoutMs:8000}),
    e=>e instanceof InspectionError&&e.code==='TLS_UNVERIFIED'&&!e.message.includes(adminPassword));
});

test('internal native client refuses to override the requested target identity',async()=>{
  await assert.rejects(client({servername:'wrong-host.internal'}).connect(),
    e=>e.code==='NUBLOX_TLS_REQUIRED');
});

test('PostgreSQL without SSL enabled is refused before credentials are sent',async()=>{
  await assert.rejects(inspectDatabase({...base,port:5432},{timeoutMs:8000}),
    e=>e instanceof InspectionError&&e.code==='TLS_UNVERIFIED');
});

test('Shell completes verified-TLS inspection with only CA file path in environment',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'nubloxsql-tls-'));
  const destination=join(dir,'inventory.json');
  try {
    const proc=spawnSync(process.execPath,
      ['apps/shell/dist/cli.js','shell','inspect','--profile','tls-fixture',
       '--format','json','--output',destination],
      {encoding:'utf8',env:{...process.env,
        NUBLOXSQL_PROFILE_ALIAS:'tls-fixture',
        NUBLOXSQL_PG_HOST:'127.0.0.1',NUBLOXSQL_PG_PORT:'5433',
        NUBLOXSQL_PG_USER:'postgres',NUBLOXSQL_PG_DATABASE:'postgres',
        NUBLOXSQL_PG_PASSWORD:adminPassword,NUBLOXSQL_PG_SECURITY:'verified-tls',
        NUBLOXSQL_PG_CA_FILE:caPath}});
    assert.equal(proc.status,0,proc.stderr);
    const {readFile}=await import('node:fs/promises');
    const result=JSON.parse(await readFile(destination,'utf8'));
    assert.equal(result.transportSecurity,'verified-tls');
    assert.ok(result.databases.some(x=>x.name==='postgres'));
    assert.equal(JSON.stringify(result).includes(adminPassword),false);
  }finally{await rm(dir,{recursive:true,force:true});}
});
