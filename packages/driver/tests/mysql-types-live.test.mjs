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

live('leading U+FEFF survives a real MySQL UTF-8 roundtrip in prepared and text protocols',async()=>{
 const db=await connectDatabase(target);
 try{
  await db.query('CREATE TEMPORARY TABLE nublox_unicode_prefix (id INT PRIMARY KEY, value TEXT CHARACTER SET utf8mb4)');
  const samples=['\ufeff','\ufeffabc','\ufeff\ufeffé🚀','abc\ufeff',''];
  for(const [id,value] of samples.entries())
   await db.query('INSERT INTO nublox_unicode_prefix (id,value) VALUES (?,?)',[id,value]);
  for(const result of [
   await db.query('SELECT value, HEX(value) AS encoded FROM nublox_unicode_prefix ORDER BY id'),
   await db.queryText('SELECT value, HEX(value) AS encoded FROM nublox_unicode_prefix ORDER BY id')
  ]){
   assert.deepEqual(result.rows.map(row=>row.value),samples);
   assert.deepEqual(result.rows.map(row=>row.encoded),
     samples.map(value=>Buffer.from(value,'utf8').toString('hex').toUpperCase()));
   assert.deepEqual(result.rowValues.map(row=>row[0]),samples);
  }
  assert.equal(db.closed,false);
 }finally{await db.close();}
});

live('full 65-digit DECIMAL and 30-place scale retain exact values across both protocols',async()=>{
 const db=await connectDatabase(target);
 try{
  await db.query('CREATE TEMPORARY TABLE nublox_exact_decimal (id INT PRIMARY KEY, integer_value DECIMAL(65,0), fraction_value DECIMAL(65,30))');
  const samples=[
   ['9'.repeat(65),'9'.repeat(35)+'.'+'9'.repeat(30)],
   ['-'+'9'.repeat(65),'-'+'9'.repeat(35)+'.'+'9'.repeat(30)],
   ['0','0.'+'0'.repeat(30)],
   ['1','-0.'+'0'.repeat(29)+'1'],
   [null,null]
  ];
  for(const [i,[integer,fraction]] of samples.entries())
   await db.query('INSERT INTO nublox_exact_decimal VALUES (?,?,?)',[i,integer,fraction]);
  for(const result of [
   await db.query('SELECT integer_value, fraction_value FROM nublox_exact_decimal ORDER BY id'),
   await db.queryText('SELECT integer_value, fraction_value FROM nublox_exact_decimal ORDER BY id')
  ]){
   assert.deepEqual(result.rows.map(row=>[row.integer_value,row.fraction_value]),samples);
   assert.deepEqual(result.rowValues,samples);
  }
  assert.equal(db.closed,false);
 }finally{await db.close();}
});

live('MEDIUMINT YEAR and finite floating-point boundaries agree across result protocols',async()=>{
 const db=await connectDatabase(target);
 try{
  await db.query('CREATE TEMPORARY TABLE nublox_numeric_domains (id INT PRIMARY KEY, signed_m MEDIUMINT, unsigned_m MEDIUMINT UNSIGNED, year_value YEAR, float_value FLOAT, double_value DOUBLE)');
  const samples=[
   [-8388608,0,1901,-1.25,-3.5],
   [8388607,16777215,2155,3.25,1e100],
   [0,8388608,0,0,0],
   [null,null,null,null,null]
  ];
  const insert='INSERT INTO nublox_numeric_domains VALUES (?,?,?,?,?,?)';
  // JS represents 1e100 as an integer-valued number outside the safe
  // integer domain. Preserve the existing input rejection policy; bind
  // its decimal exponent string for the server's DOUBLE conversion.
  await assert.rejects(db.query(insert,[1,...samples[1]]),e=>e.code==='INVALID_INPUT');
  assert.equal(db.closed,false);
  for(const [id,values] of samples.entries()){
   const parameters=[...values];
   if(id===1)parameters[4]='1e100';
   await db.query(insert,[id,...parameters]);
  }
  for(const result of [
   await db.query('SELECT signed_m,unsigned_m,year_value,float_value,double_value FROM nublox_numeric_domains ORDER BY id'),
   await db.queryText('SELECT signed_m,unsigned_m,year_value,float_value,double_value FROM nublox_numeric_domains ORDER BY id')
  ]){
   assert.deepEqual(result.rowValues,samples);
   assert.equal(result.columns[0].type,9);
   assert.equal(result.columns[1].unsigned,true);
   assert.equal(result.columns[2].type,13);
  }
  assert.equal(db.closed,false);
 }finally{await db.close();}
});

live('temporal results preserve all fractional precisions and permitted incomplete dates',async()=>{
 const db=await connectDatabase(target);
 try{
  await db.query("SET SESSION time_zone = '+00:00'");
  await db.query("SET SESSION sql_mode = 'ALLOW_INVALID_DATES'");
  await db.query('CREATE TEMPORARY TABLE nublox_temporal_modes (id INT PRIMARY KEY, d DATE, dt DATETIME(6), t TIME(6), ts TIMESTAMP(6))');
  const samples=[
   ['0000-00-00','0000-00-00 00:00:00.000000','00:00:00.000000','0000-00-00 00:00:00.000000'],
   ['2024-00-15','2024-04-31 12:34:56.123456','-838:59:59.000000','2024-02-29 12:34:56.123456'],
   ['2024-02-31','2024-02-00 01:02:03.000001','838:59:59.000000','2024-02-29 00:00:00.000001'],
   [null,null,null,null]
  ];
  for(const [id,values] of samples.entries())
   await db.query('INSERT INTO nublox_temporal_modes VALUES (?,?,?,?,?)',[id,...values]);
  const sql='SELECT d,dt,t,ts FROM nublox_temporal_modes ORDER BY id';
  for(const result of [await db.query(sql),await db.queryText(sql)])
   assert.deepEqual(result.rowValues,samples);
  // Fixed trusted precision integers only; no user data is interpolated.
  for(let precision=0;precision<=6;precision++){
   const suffix=precision?'.'+'123456'.slice(0,precision):'';
   const dt='2024-02-29 12:34:56'+suffix;
   const t='-26:03:04'+suffix;
   const cast="SELECT CAST('"+dt+"' AS DATETIME("+precision+")) AS dt, CAST('"+t+"' AS TIME("+precision+")) AS t";
   for(const result of [await db.query(cast),await db.queryText(cast)])
    assert.deepEqual(result.rowValues,[[dt,t]]);
  }
  assert.equal(db.closed,false);
 }finally{await db.close();}
});

live('UTF-8 column aliases and physical identifiers retain exact identity in both protocols',async()=>{
 const db=await connectDatabase(target);
 try{
  await db.query("SET SESSION character_set_results = 'utf8mb4'");
  await db.query('CREATE TEMPORARY TABLE nublox_metadata_identity (`café_東京` INT)');
  await db.query('INSERT INTO nublox_metadata_identity VALUES (42)');
  const sql='SELECT `café_東京` AS `résultat_東京`, `café_東京` AS `résultat_東京` FROM nublox_metadata_identity AS `別名`';
  for(const result of [await db.query(sql),await db.queryText(sql)]){
   assert.deepEqual(result.columnKeys,['résultat_東京','résultat_東京#2']);
   assert.deepEqual(result.rowValues,[[42,42]]);
   assert.equal(result.rows[0]['résultat_東京'],42);
   for(const column of result.columns){
    assert.equal(column.name,'résultat_東京');
    assert.equal(column.originalName,'café_東京');
    assert.equal(column.table,'別名');
    assert.equal(column.originalTable,'nublox_metadata_identity');
   }
  }
 }finally{await db.close();}
});
