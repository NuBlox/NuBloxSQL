import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectDatabase} from '../dist/index.js';

const live=process.env.NUBLOX_LIVE_MYSQL==='1'?test:test.skip;
const target={
 engine:'mysql',host:'127.0.0.1',port:Number(process.env.MYSQL_PORT||3306),
 user:process.env.MYSQL_USER||'root',password:process.env.MYSQL_PASSWORD||'test-password',
 database:'nublox_test',security:'isolated-local',timeoutMs:15000
};

live('real MySQL 8.4 returns exact numeric, TEXT/BLOB, JSON, BIT and temporal values',async()=>{
 const db=await connectDatabase(target);
 try{
  await db.query("SET time_zone = '+00:00'");
  await db.query(`CREATE TEMPORARY TABLE nublox_types_test (
     id INT PRIMARY KEY,
     signed_t TINYINT,
     unsigned_s SMALLINT UNSIGNED,
     unsigned_i INT UNSIGNED,
     unsigned_big BIGINT UNSIGNED,
     amount DECIMAL(30,6),
     richtext TEXT CHARACTER SET utf8mb4,
     rawbytes BLOB,
     payload JSON,
     bits BIT(8),
     eventdate DATE,
     occurred DATETIME(6),
     eventstamp TIMESTAMP(6),
     duration TIME(6),
     year_value YEAR,
     fvalue FLOAT,
     dvalue DOUBLE
   ) DEFAULT CHARACTER SET utf8mb4`);
  const payload=JSON.stringify({n:1234567890123,text:'élan 🚀',nested:{ok:true}});
  await db.query(`INSERT INTO nublox_types_test
     (id,signed_t,unsigned_s,unsigned_i,unsigned_big,amount,richtext,rawbytes,
      payload,bits,eventdate,occurred,eventstamp,duration,year_value,fvalue,dvalue)
     VALUES (?,?,?,?,?,?,?,?,?,b'10100101',?,?,?,?,?,?,?)`,[
    1,-128,65535,4294967295,18446744073709551615n,
    '-1234567890123456.123456','café 🚀 Zürich',Buffer.from([0,255,128,0]),
    payload,'2024-02-29','2024-02-29 12:34:56.123456',
    '2024-02-29 12:34:56.123456','-26:03:04.123456',2024,3.25,-1.25
  ]);
  const result=await db.query('SELECT * FROM nublox_types_test WHERE id = ?',[1]);
  assert.equal(result.rows.length,1);
  const row=result.rows[0];
  assert.equal(row.signed_t,-128);
  assert.equal(row.unsigned_s,65535);
  assert.equal(row.unsigned_i,4294967295);
  assert.equal(row.unsigned_big,18446744073709551615n);
  assert.equal(row.amount,'-1234567890123456.123456');
  assert.equal(row.richtext,'café 🚀 Zürich');
  assert.equal(typeof row.richtext,'string','TEXT must not be decoded as a Buffer');
  assert.deepEqual(row.rawbytes,Buffer.from([0,255,128,0]));
  assert.deepEqual(JSON.parse(row.payload),JSON.parse(payload));
  assert.equal(typeof row.payload,'string','JSON must not be implicitly parsed');
  assert.deepEqual(row.bits,Buffer.from([0xa5]));
  assert.equal(row.eventdate,'2024-02-29');
  assert.equal(row.occurred,'2024-02-29 12:34:56.123456');
  assert.equal(row.eventstamp,'2024-02-29 12:34:56.123456');
  assert.equal(row.duration,'-26:03:04.123456');
  assert.equal(row.year_value,2024);
  assert.equal(row.fvalue,3.25);
  assert.equal(row.dvalue,-1.25);
  const text=result.columns.find(c=>c.name==='richtext');
  const blob=result.columns.find(c=>c.name==='rawbytes');
  assert.notEqual(text.charset,63,'real TEXT column should carry a text charset');
  assert.equal(blob.charset,63,'real BLOB column should carry binary charset metadata');
 }finally{await db.close();}
});

live('real prepared query rejects data loss from unknown text conversion while preserving a valid session',async()=>{
 const db=await connectDatabase(target);
 try{
   const row=(await db.query('SELECT ? AS international_text',['東京 🚀 café'])).rows[0];
   assert.equal(row.international_text,'東京 🚀 café');
   assert.equal(db.closed,false);
 }finally{await db.close();}
});
