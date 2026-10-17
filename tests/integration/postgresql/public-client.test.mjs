import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectDatabase, DriverError} from '@nubloxsql/driver';
const password=process.env.NUBLOXSQL_CI_ADMIN_PASSWORD;
if(!password)throw Error('Requires disposable PostgreSQL 17 service');
test('one public NuBloxSQL client API operates against PostgreSQL native protocol',async()=>{
 const client=await connectDatabase({engine:'postgresql',host:'127.0.0.1',port:5432,
  user:'postgres',database:'postgres',password,security:'isolated-local',timeoutMs:10000});
 try{
  assert.equal(client.info.engine,'postgresql');
  assert.equal(client.info.model,'relational');
  assert.equal(client.info.transport,'isolated-local');
  assert.ok(client.info.capabilities.includes('sql.query.rows-bounded'));
  const result=await client.query('SELECT $1::integer + 1 AS answer',[41]);
  assert.equal(result.rows[0].answer,'42'); // Native PG inventory currently exposes text values
  assert.equal((await client.query('SELECT current_database() AS db')).rows[0].db,'postgres');
 }finally{await client.close();}
 await assert.rejects(client.query('SELECT 1'),e=>e instanceof DriverError&&e.code==='OPERATION_FAILED');
});
