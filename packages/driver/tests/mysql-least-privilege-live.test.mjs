import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {connectDatabase,createDatabasePool} from '../dist/index.js';

// This test must never use a production database or privileged account.
// The dedicated disposable fixture is installed explicitly by CI.
const enabled=process.env.NUBLOX_LIVE_MYSQL_RESTRICTED==='1';
const live=enabled?test:test.skip;
const tls=process.env.NUBLOX_LIVE_MYSQL_TLS==='1';
const version=process.env.NUBLOX_TEST_MYSQL_VERSION;
if(enabled&&(
  process.env.CI!=='true'||
  !['8.4.13','9.7.4','26.10.0'].includes(version)||
  (tls&&!['8.4.13','9.7.4'].includes(version))
))throw Error('Restricted-principal qualification requires pinned disposable CI fixture');

function target(){
 const options={
  engine:'mysql',host:'127.0.0.1',
  port:Number(process.env[tls?'MYSQL_TLS_PORT':'MYSQL_PORT']??(tls?3307:3306)),
  user:'nubloxsql_readonly',password:'nublox-test-readonly-credential',
  database:'nublox_test',security:tls?'verified-tls':'isolated-local',
  timeoutMs:12000
 };
 if(tls){
  options.ca=readFileSync(process.env.NUBLOX_TLS_CA_FILE,'utf8');
  options.serverName='localhost';
 }
 return options;
}
const exactVersion=actual=>actual===version||actual.startsWith(version+'-');
const fixture='nublox_least_privilege_fixture';
async function readValue(db){
 const result=await db.query(
  'SELECT value FROM nublox_least_privilege_fixture WHERE id = ?',[1]);
 assert.equal(result.rows.length,1);
 assert.equal(result.rows[0].value,'approved-read-only-test-row');
}
async function rejectedWrites(db){
 for(const [sql,params] of [
  ['UPDATE nublox_least_privilege_fixture SET value = ? WHERE id = ?',['unauthorised',1]],
  ['DELETE FROM nublox_least_privilege_fixture WHERE id = ?',[1]],
  ['INSERT INTO nublox_least_privilege_fixture (id,value) VALUES (?,?)',
    [2,'unauthorised']],
  ['CREATE TABLE nublox_readonly_must_not_create (id INT)',[]]
 ]){
  await assert.rejects(db.query(sql,params),error=>
   error?.code==='DATABASE_ERROR'&&Number.isInteger(error.vendorCode)&&error.vendorCode>0);
 }
 await readValue(db);
}

live('least-privilege MySQL user authenticates and cannot execute writes or DDL',async()=>{
 const db=await connectDatabase(target());
 try{
  assert.ok(exactVersion(db.info.version),'unexpected server release');
  assert.equal(db.info.transport,tls?'verified-tls':'isolated-local');
  const identity=(await db.query('SELECT CURRENT_USER() AS identity')).rows[0].identity;
  assert.equal(typeof identity,'string');
  assert.ok(identity.startsWith('nubloxsql_readonly@'));
  await readValue(db);
  await rejectedWrites(db);
  assert.equal(db.closed,false,'expected privilege errors must not corrupt session');
  await db.transaction(async tx=>{
   const res=await tx.query('SELECT ? AS scoped_value',[87]);
   assert.equal(res.rows[0].scoped_value,87n);
  });
  await readValue(db);
 }finally{await db.close();}
 assert.equal(db.closed,true);
});

live('restricted MySQL user retains native prepared statements and read-only cursor access',async()=>{
 const db=await connectDatabase(target());
 try{
  const stmt=await db.prepare('SELECT ? AS statement_value');
  try{
   for(let i=0;i<3;i++)
    assert.equal((await stmt.execute([i])).rows[0].statement_value,BigInt(i));
  }finally{await stmt.close();}
  const values=await db.withCursor(
   'SELECT id, value FROM nublox_least_privilege_fixture WHERE id >= ?',[1],
   async cursor=>{
    const rows=[];
    for await(const {row} of cursor)rows.push(row);
    return rows;
   },{fetchSize:1});
  assert.equal(values.length,1);
  assert.equal(values[0].value,'approved-read-only-test-row');
  await readValue(db);
 }finally{await db.close();}
});

live('restricted MySQL sessions can be pooled and reset without privilege escalation',async()=>{
 const pool=createDatabasePool(target(),{maxConnections:2,
  acquireTimeoutMs:5000,healthCheckTimeoutMs:2000});
 try{
  await pool.withConnection(async lease=>{
   await readValue(lease);
   await rejectedWrites(lease);
   await lease.query('SET @nublox_readonly_marker = 42');
  });
  await pool.withConnection(async lease=>{
   assert.equal((await lease.query(
    'SELECT @nublox_readonly_marker AS marker')).rows[0].marker,null);
   await readValue(lease);
   const identity=(await lease.query('SELECT CURRENT_USER() AS identity'))
    .rows[0].identity;
   assert.ok(identity.startsWith('nubloxsql_readonly@'));
  });
  assert.ok(pool.stats.size<=2);
  assert.equal(pool.stats.pending,0);
 }finally{await pool.close();}
 assert.equal(pool.stats.size,0);
 assert.equal(pool.stats.pending,0);
});

live('restricted TLS user rejects plaintext and incorrect credentials without secrets',async()=>{
 if(!tls)return;
 const connection=target();
 const attempted={...connection,security:'isolated-local'};
 delete attempted.ca;
 delete attempted.serverName;
 await assert.rejects(connectDatabase(attempted),error=>error instanceof Error);
 const sentinel='NUBLOX_NEVER_LOG_RESTRICTED_PASSWORD_9184';
 await assert.rejects(connectDatabase({...connection,password:sentinel}),error=>{
  assert.equal(error?.code,'DATABASE_ERROR');
  assert.ok(!String(error.message).includes(sentinel));
  return true;
 });
 const db=await connectDatabase(connection);
 try{
  const res=await db.query(
   "SELECT VARIABLE_VALUE AS cipher FROM performance_schema.session_status WHERE VARIABLE_NAME = 'Ssl_cipher'");
  assert.equal(res.rows.length,1);
  assert.ok(typeof res.rows[0].cipher==='string'&&res.rows[0].cipher.length>0);
  await readValue(db);
 }finally{await db.close();}
});
