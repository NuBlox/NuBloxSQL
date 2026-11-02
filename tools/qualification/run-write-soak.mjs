#!/usr/bin/env node
/** CI-only disposable write qualification: no customer SQL, rows or secrets in reports. */
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {platform,arch} from 'node:os';
import {connectDatabase,createDatabasePool} from '../../packages/driver/dist/index.js';
import {safeError} from './metrics.mjs';
import {parseWriteSoakOptions,checkWriteSoakEnvironment,
  checkVerifiedTlsWriteSoakEnvironment,runWriteSoak} from './write-soak.mjs';

const options=parseWriteSoakOptions(process.argv.slice(2));
const profile=process.env.NUBLOX_WRITE_SOAK_PROFILE??'isolated-local';
assert.ok(profile==='isolated-local'||profile==='verified-tls',
  'Only reviewed write-soak profiles are supported');
const tls=profile==='verified-tls';
const table=tls?checkVerifiedTlsWriteSoakEnvironment(process.env):
  checkWriteSoakEnvironment(process.env);
const base={engine:'mysql',host:'127.0.0.1',database:'nublox_test',
  security:profile,timeoutMs:30000,
  port:tls?3307:3306};
if(tls){
  base.ca=readFileSync(process.env.NUBLOX_TLS_CA_FILE,'utf8');
  base.serverName='localhost';
}
const target={...base,user:tls?process.env.MYSQL_WRITE_USER:
  process.env.MYSQL_USER??'root',
  password:tls?process.env.MYSQL_WRITE_PASSWORD:
    process.env.MYSQL_PASSWORD??'test-password'};
const administratorTarget=tls?{...base,
  user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD??'test-password'}:target;

/** Verify working TLS session, then reject invalid CA, identity and password. */
async function verifyTlsSafety(){
  const connection=await connectDatabase(target);
  try{
    assert.equal(connection.info.transport,'verified-tls');
    const secure=await connection.query('SELECT @@global.require_secure_transport AS required');
    assert.equal(Number(secure.rows[0].required),1);
    await assert.rejects(connection.query(
      'CREATE TABLE nublox_write_soak_forbidden (id INT)'),
      error=>error?.code==='DATABASE_ERROR');
  }finally{await connection.close();}
  const unrelated=readFileSync(process.env.NUBLOX_TLS_OTHER_CA_FILE,'utf8');
  await assert.rejects(connectDatabase({...target,ca:unrelated}));
  await assert.rejects(connectDatabase({...target,serverName:'invalid.nublox.local'}));
  await assert.rejects(connectDatabase({...target,password:'bad-fixture-password'}));
  return {trustedIdentity:true,unrelatedCaRejected:true,
    wrongHostnameRejected:true,invalidPasswordRejected:true,
    serverRequiresTls:true,restrictedDdlRejected:true};
}
const report={schemaVersion:1,kind:'mysql-write-soak',status:'running',
  environment:{revision:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID,
    event:process.env.GITHUB_EVENT_NAME,node:process.version,
    platform:platform(),arch:arch(),ci:true,
    transport:profile,serverVersion:null,
    clientPrincipal:tls?'nublox_write_test':null,
    tlsChecks:null},
  options,workload:null,errors:{unexpected:0,codes:[]}};
try{
  if(tls)report.environment.tlsChecks=await verifyTlsSafety();
  const workload=await runWriteSoak({
    connect:connectDatabase,createPool:createDatabasePool,
    target,table,options,administratorTarget
  });
  report.workload=workload;
  report.environment.serverVersion=workload.serverVersion;
  report.status='passed';
}catch(error){
  process.exitCode=1;
  report.status='failed';
  report.errors.unexpected=1;
  report.errors.codes=[safeError(error)];
}finally{
  const output=resolve('artifacts/qualification');
  mkdirSync(output,{recursive:true});
  const filename=tls?'mysql-write-soak-tls-':'mysql-write-soak-';
  const file=resolve(output,filename+process.env.GITHUB_RUN_ID+'.json');
  writeFileSync(file,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({
    kind:report.kind,status:report.status,report:file,
    elapsedMs:report.workload?.observedDurationMs??0,
    committed:report.workload?.committedTransactions??0,
    rolledBack:report.workload?.rolledBackTransactions??0,
    unexpectedErrors:report.errors.unexpected
  }));
}
