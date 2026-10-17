import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {connectDatabase, DriverError} from '@nubloxsql/driver';
const caFile=process.env.NUBLOXSQL_CI_TLS_CA_FILE,password=process.env.NUBLOXSQL_CI_ADMIN_PASSWORD;
if(!caFile||!password)throw Error('Requires disposable CA-signed TLS PostgreSQL 17 fixture');
test('public native Driver connects with exact verified-TLS identity to PostgreSQL 17',async()=>{
 const caCertificate=await readFile(caFile,'utf8');
 const client=await connectDatabase({engine:'postgresql',host:'127.0.0.1',port:5433,
  database:'postgres',user:'postgres',password,security:'verified-tls',caCertificate});
 try {
  assert.equal(client.info.transport,'verified-tls');
  assert.ok(client.info.capabilities.includes('transport.verified-tls'));
  const rows=(await client.query('SELECT ssl::text AS enabled FROM pg_stat_ssl WHERE pid=pg_backend_pid()')).rows;
  assert.equal(rows[0].enabled,'true');
 }finally{await client.close();}
});
test('public Driver sanitises wrong-certificate failures',async()=>{
 const caCertificate=await readFile(caFile,'utf8');
 await assert.rejects(connectDatabase({engine:'postgresql',host:'127.0.0.1',port:5434,
  database:'postgres',user:'postgres',password,security:'verified-tls',caCertificate}),
  e=>e instanceof DriverError&&e.code==='CONNECTION_FAILED'&&!e.message.includes(password));
});
