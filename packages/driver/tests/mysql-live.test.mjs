import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectDatabase} from '../dist/index.js';
const live=process.env.NUBLOX_LIVE_MYSQL==='1'?test:test.skip;
const target={engine:'mysql',host:'127.0.0.1',port:Number(process.env.MYSQL_PORT||3306),user:process.env.MYSQL_USER||'root',password:process.env.MYSQL_PASSWORD||'test-password',database:'nublox_test',security:'isolated-local',timeoutMs:15000};

live('MySQL 8.4 real handshake, prepared statements, type fidelity, errors and rollback',async()=>{
 const db=await connectDatabase(target);
 try{
  assert.match(db.info.version,/^8\.4\./);
  const basic=await db.query('SELECT ? AS label, ? AS amount, ? AS nullable',['hello',42,null]);
  assert.equal(basic.rows[0].label,'hello');assert.equal(basic.rows[0].amount,42n);
  assert.equal(basic.rows[0].nullable,null);
  const version=await db.query('SELECT VERSION() AS server_version');
  assert.match(version.rows[0].server_version,/^8\.4\./);
  await db.query('CREATE TEMPORARY TABLE nublox_native_test (id INT PRIMARY KEY,label VARCHAR(255),amount DECIMAL(20,5),bin VARBINARY(255))');
  await db.transaction(async tx=>{await tx.query('INSERT INTO nublox_native_test (id,label,amount,bin) VALUES (?,?,?,?)',[1,'safe','123456789.12345',Buffer.from([0,255])]);});
  await assert.rejects(db.transaction(async tx=>{await tx.query('INSERT INTO nublox_native_test (id,label) VALUES (?,?)',[2,'rollback']);throw Error('cancel transaction');}),/cancel transaction/);
  const result=await db.query('SELECT label,amount,bin FROM nublox_native_test WHERE id = ?',[1]);
  assert.equal(result.rows[0].label,'safe');assert.equal(result.rows[0].amount,'123456789.12345');
  assert.deepEqual(result.rows[0].bin,Buffer.from([0,255]));
  assert.equal((await db.query('SELECT id FROM nublox_native_test WHERE id = ?',[2])).rows.length,0);
  assert.equal((await db.query('SELECT id FROM nublox_native_test WHERE label = ?',["safe' OR 1=1 --"])).rows.length,0);
  await assert.rejects(db.query('SELECT * FROM missing_nublox_table'),e=>e.code==='DATABASE_ERROR'&&e.vendorCode>0);
  assert.equal((await db.query('SELECT ? AS again',[7])).rows[0].again,7n);
 }finally{await db.close();}assert.equal(db.closed,true);
});
