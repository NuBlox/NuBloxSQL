import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {connectDatabase, DriverError} from '@nubloxsql/driver';

test('public Driver API opens embedded SQLite with model-aware native capability discovery',async()=>{
 const db=await connectDatabase({engine:'sqlite',mode:'memory'});
 try {
  assert.equal(db.info.model,'relational');
  assert.equal(db.info.engine,'sqlite');
  assert.equal(db.info.transport,'embedded');
  assert.ok(db.info.capabilities.includes('sql.parameter-binding.text-numeric'));
  assert.ok(!db.info.capabilities.includes('transport.verified-tls'));
  await db.query('CREATE TABLE articles (id INTEGER PRIMARY KEY, title TEXT NOT NULL)');
  await db.query('INSERT INTO articles (id,title) VALUES (?, ?)',[1,'native']);
  const rows=(await db.query('SELECT id,title FROM articles WHERE id = ?',[1])).rows;
  assert.equal(rows.length,1);
  assert.equal(rows[0].id,1n); // Native SQLite int64; not coerced to JS unsafe number
  assert.equal(rows[0].title,'native');
  assert.equal((await db.query('SELECT title FROM articles WHERE title = ?',["native' OR 1=1 --"])).rows.length,0);
 }finally{await db.close();}
 await assert.rejects(db.query('SELECT 1'),e=>e instanceof DriverError&&e.code==='OPERATION_FAILED');
 await db.close();
});
test('an embedded SQLite file can be reopened read-only, with native privileges enforced',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nubloxsql-embedded-'));
 const filename=join(dir,'db.sqlite');
 try{
  const writer=await connectDatabase({engine:'sqlite',mode:'read-write-create',filename});
  try{
   await writer.query('CREATE TABLE samples (value TEXT NOT NULL)');
   await writer.query('INSERT INTO samples(value) VALUES (?)',['persisted']);
  }finally{await writer.close();}
  const reader=await connectDatabase({engine:'sqlite',mode:'read-only',filename});
  try{
   assert.equal((await reader.query('SELECT value FROM samples')).rows[0].value,'persisted');
   await assert.rejects(reader.query('INSERT INTO samples(value) VALUES (?)',['unsafe']),
     e=>e instanceof DriverError&&e.code==='OPERATION_FAILED');
  }finally{await reader.close();}
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('SQLite aggregate result resource budget fails with stable redacted error',async()=>{
 const db=await connectDatabase({engine:'sqlite',mode:'memory'});
 try{
  await assert.rejects(db.query("SELECT hex(zeroblob(500000)) AS huge"),
    e=>e instanceof DriverError&&e.code==='RESOURCE_LIMIT'&&e.nativeCode==='NUBLOX_SQLITE_MAX_ROW_BYTES');
  await assert.rejects(db.query('WITH RECURSIVE seq(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM seq WHERE x<1002) SELECT x FROM seq'),
    e=>e instanceof DriverError&&e.code==='RESOURCE_LIMIT'&&e.nativeCode==='NUBLOX_SQLITE_MAX_ROWS');
 }finally{await db.close();}
});
test('unsupported database engines and non-SQL models fail explicitly without fallback',async()=>{
 for(const engine of ['mysql','mongodb','redis','neo4j','unknown']){
  await assert.rejects(connectDatabase({engine}),e=>e instanceof DriverError&&e.code==='UNSUPPORTED_ENGINE');
 }
 await assert.rejects(connectDatabase({engine:'postgresql',host:'example.org',port:5432,user:'a',database:'b',password:'x',security:'isolated-local'}),
  e=>e instanceof DriverError&&e.code==='INVALID_INPUT');
 await assert.rejects(connectDatabase({engine:'sqlite',mode:'memory',filename:'/etc/passwd'}),
  e=>e instanceof DriverError&&e.code==='INVALID_INPUT');
});
test('native client validates SQL and bound parameters before execution',async()=>{
 const db=await connectDatabase({engine:'sqlite',mode:'memory'});
 try{
  await assert.rejects(db.query('SELECT ?',[Infinity]),e=>e instanceof DriverError&&e.code==='INVALID_INPUT');
  await assert.rejects(db.query('SELECT ?',[NaN]),e=>e instanceof DriverError&&e.code==='INVALID_INPUT');
  await assert.rejects(db.query('SELECT 1\0SELECT 2'),e=>e instanceof DriverError&&e.code==='INVALID_INPUT');
  await assert.rejects(db.query(''),e=>e instanceof DriverError&&e.code==='INVALID_INPUT');
 }finally{await db.close();}
});
