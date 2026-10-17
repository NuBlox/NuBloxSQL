import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {NativePgClient} from '../../../packages/driver/dist/adapters/postgresql/wire.js';

const password=process.env.NUBLOXSQL_CI_ADMIN_PASSWORD;
if(!password) throw Error('Governance integration tests require isolated disposable PostgreSQL CI.');
function client({connectTimeout=10000,queryTimeout=10000}={}) {
  return new NativePgClient({
    host:'127.0.0.1',port:5432,user:'postgres',database:'postgres',password,ssl:false,
    connectionTimeoutMillis:connectTimeout,query_timeout:queryTimeout,
    statement_timeout:queryTimeout,application_name:'nubloxsql-native-governance-ci'
  });
}
test('startup deadline ends on authentication and does not terminate an idle healthy session', async()=>{
  const c=client({connectTimeout:1500,queryTimeout:3000});
  await c.connect();
  try {
    await delay(1750);
    const result=await c.query('SELECT 41 + 1 AS answer');
    assert.equal(result.rows[0].answer,'42');
  } finally {await c.end();}
});
test('a timed out query terminates its session and prevents response desynchronization',async()=>{
  const c=client({queryTimeout:100});
  await c.connect();
  try{
    await assert.rejects(c.query('SELECT pg_sleep(1)'),e=>e.code==='ETIMEDOUT');
    await assert.rejects(c.query('SELECT 1'),/Invalid native query state/);
  } finally {await c.end();}
});
test('a SQL error cannot let the next query consume stale ReadyForQuery',async()=>{
  const c=client();
  await c.connect();
  try{
    await assert.rejects(c.query('SELECT column_that_does_not_exist FROM pg_catalog.pg_database'),e=>e.code==='42703');
    await assert.rejects(c.query('SELECT 1'),/Invalid native query state/);
  } finally {await c.end();}
});
test('single native connection refuses concurrent query interleaving without discarding the first query',async()=>{
  const c=client();
  await c.connect();
  try{
    const first=c.query('SELECT pg_sleep(0.15)');
    await assert.rejects(c.query('SELECT 1'),/Concurrent native queries/);
    await first;
    assert.equal((await c.query('SELECT 2 AS value')).rows[0].value,'2');
  } finally {await c.end();}
});
test('oversized native row fails with explicit byte-limit code and invalidates the connection',async()=>{
  const c=client();
  await c.connect();
  try{
    await assert.rejects(c.query("SELECT repeat('a', 2097153) AS large_value"),
      e=>e.code==='NUBLOX_POSTGRESQL_MAX_ROW_BYTES');
    await assert.rejects(c.query('SELECT 1'),/Invalid native query state/);
  } finally {await c.end();}
});
test('aggregate result bytes are limited even when individual rows are small',async()=>{
  const c=client();
  await c.connect();
  try{
    await assert.rejects(c.query("SELECT repeat('a', 350000) AS chunk FROM generate_series(1, 26)"),
      e=>e.code==='NUBLOX_POSTGRESQL_MAX_RESULT_BYTES');
    await assert.rejects(c.query('SELECT 1'),/Invalid native query state/);
  } finally {await c.end();}
});
