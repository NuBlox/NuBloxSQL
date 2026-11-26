import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Cursor} from '../dist/vendors/mysql/protocol/primitives.js';
import {ok,acknowledgedOk,binaryResultColumnCount} from '../dist/vendors/mysql/protocol/results.js';
import {connectDatabase} from '../dist/index.js';

// Independent wire fixtures taken from the published length-encoded integer
// boundaries, not from the driver's own encoder.
const cases=[
 [0,'00'],[250,'fa'],[251,'fcfb00'],[65535,'fcffff'],
 [65536,'fd000001'],[16777215,'fdffffff'],
 [16777216,'fe0000000100000000'],
 [Number.MAX_SAFE_INTEGER,'feffffffffffff1f00'],
 [9007199254740992n,'fe0000000000002000'],
 [9007199254740993n,'fe0100000000002000'],
 [18446744073709551615n,'feffffffffffffffff']
];
const wire=hex=>Buffer.from(hex,'hex');
const acknowledgement=(rows,id,flags=2)=>Buffer.concat([
 Buffer.from([0]),rows,id,Buffer.from([flags,0,3,0])
]);
test('length-encoded numeric values retain every boundary and full uint64 precision',()=>{
 for(const [value,hex] of cases){
  const bytes=wire(hex);
  const reader=new Cursor(bytes);
  assert.equal(reader.lenInteger(),value);
  assert.equal(reader.remaining(),0);
  if(typeof value==='bigint'){
   assert.throws(()=>new Cursor(bytes).len(),/Overlarge length/);
   assert.throws(()=>new Cursor(bytes).lbytes(),/Overlarge length/);
   assert.throws(()=>binaryResultColumnCount(bytes),e=>e.code==='PROTOCOL_ERROR');
  }else assert.equal(new Cursor(bytes).len(),value);
  for(let n=0;n<bytes.length;n++)
   assert.throws(()=>new Cursor(bytes.subarray(0,n)).lenInteger());
 }
 assert.equal(new Cursor(wire('fb')).lenInteger(),null);
 assert.throws(()=>new Cursor(wire('ff')).lenInteger(),/Invalid encoded length/);
});
test('both acknowledgement fields independently preserve exact uint64 values',()=>{
 for(const [value,hex] of cases){
  const bytes=wire(hex);
  for(const [rows,id,expectedRows,expectedId] of [
   [bytes,wire('00'),value,0],[wire('00'),bytes,0,value],[bytes,bytes,value,value]
  ]){
   const packet=acknowledgement(rows,id);
   for(const parse of [ok,acknowledgedOk]){
    const result=parse(packet);
    assert.equal(result.affectedRows,expectedRows);
    assert.equal(result.insertId,expectedId);
    assert.equal(result.status,2);
    assert.equal(result.warnings,3);
   }
   for(let n=0;n<packet.length;n++)
    assert.throws(()=>ok(packet.subarray(0,n)),e=>e.code==='PROTOCOL_ERROR');
  }
 }
 for(const invalid of ['fb','ff']){
  assert.throws(()=>ok(acknowledgement(wire(invalid),wire('00'))),e=>e.code==='PROTOCOL_ERROR');
  assert.throws(()=>ok(acknowledgement(wire('00'),wire(invalid))),e=>e.code==='PROTOCOL_ERROR');
 }
 const multi=acknowledgement(wire('00'),wire('feffffffffffffffff'),8);
 assert.throws(()=>acknowledgedOk(multi),e=>e.code==='UNSUPPORTED_FEATURE');
 assert.equal(ok(multi,true).insertId,18446744073709551615n);
});
const live=process.env.NUBLOX_LIVE_MYSQL==='1'?test:test.skip;
live('large AUTO_INCREMENT acknowledgements remain exact across prepared and text queries',async()=>{
 const db=await connectDatabase({
  engine:'mysql',host:'127.0.0.1',port:Number(process.env.MYSQL_PORT||3306),
  user:process.env.MYSQL_USER||'root',password:process.env.MYSQL_PASSWORD||'test-password',
  database:'nublox_test',security:'isolated-local',timeoutMs:15000
 });
 try{
  await db.query('CREATE TEMPORARY TABLE nublox_exact_ack (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, payload INT NOT NULL) ENGINE=InnoDB AUTO_INCREMENT=9007199254740992');
  const prepared=await db.query('INSERT INTO nublox_exact_ack (payload) VALUES (?)',[11]);
  assert.equal(prepared.affectedRows,1);
  assert.equal(prepared.insertId,9007199254740992n);
  const text=await db.queryText('INSERT INTO nublox_exact_ack (payload) VALUES (22)');
  assert.equal(text.affectedRows,1);
  assert.equal(text.insertId,9007199254740993n);
  const statement=await db.prepare('INSERT INTO nublox_exact_ack (payload) VALUES (?)');
  try{
   const reused=await statement.execute([33]);
   assert.equal(reused.affectedRows,1);
   assert.equal(reused.insertId,9007199254740994n);
  }finally{await statement.close();}
  const rows=(await db.query('SELECT id FROM nublox_exact_ack ORDER BY id')).rows;
  assert.deepEqual(rows.map(row=>row.id),[9007199254740992n,9007199254740993n,9007199254740994n]);
  assert.equal(db.closed,false);
  assert.equal((await db.queryText('SELECT 1 AS healthy')).rows[0].healthy,1n);
 }finally{await db.close();}
});
