import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectDatabase} from '../dist/index.js';
import {ADDITIONAL_MYSQL_COLLATIONS}
  from '../dist/vendors/mysql/collations.js';
import {decodeMysqlText} from '../dist/vendors/mysql/collations.js';

const live=process.env.NUBLOX_LIVE_MYSQL==='1'?test:test.skip;
const target={
  engine:'mysql',host:'127.0.0.1',
  port:Number(process.env.MYSQL_PORT||3306),
  user:process.env.MYSQL_USER||'root',
  password:process.env.MYSQL_PASSWORD||'test-password',
  database:'nublox_test',security:'isolated-local',timeoutMs:30000
};

live('MySQL server confirms every independently mapped international collation ID',
  async()=>{
  const db=await connectDatabase(target);
  try{
    const expected=new Map(ADDITIONAL_MYSQL_COLLATIONS);
    const ids=Array.from(expected.keys()).join(',');
    const result=await db.queryText(
      'SELECT ID, CHARACTER_SET_NAME AS charset_name FROM '+
      'INFORMATION_SCHEMA.COLLATIONS WHERE ID IN ('+ids+') ORDER BY ID'
    );
    assert.equal(result.rows.length,expected.size,
      'an assumed collation ID must not silently map to an absent server collation');
    for(const row of result.rows){
      const id=Number(row.ID);
      assert.equal(row.charset_name,expected.get(id),
        'MySQL server collation '+id+' must match decoder encoding');
    }
  }finally{await db.close();}
});

live('native prepared and literal queries roundtrip international result encodings',
  async()=>{
  const db=await connectDatabase(target);
  try{
    const scenarios=[
      ['big5','中文'],
      ['gbk','中文'],
      ['sjis','日本'],
      ['cp932','日本'],
      ['euckr','한국'],
      ['latin2','Łódź'],
      ['cp1251','Привет']
    ];
    for(const [charset,expected] of scenarios){
      // Protocol client remains UTF-8; the server explicitly converts its
      // *result* bytes to the selected character set for both query modes.
      await db.queryText("SET SESSION character_set_results='"+charset+"'");
      const sql="SELECT CONVERT(_utf8mb4'"+expected+
        "' USING "+charset+") AS international";
      for(const query of [
        ()=>db.queryText(sql),
        ()=>db.query(sql)
      ]){
        const result=await query();
        assert.equal(result.rows[0].international,expected,
          'incorrect roundtrip for '+charset);
        assert.equal(result.rowValues[0][0],expected);
        assert.notEqual(result.columns[0].charset,63);
      }
      assert.equal(db.closed,false);
    }
    await db.queryText("SET SESSION character_set_results='utf8mb4'");
    assert.equal((await db.queryText("SELECT '🚀' AS emoji")).rows[0].emoji,'🚀');
  }finally{await db.close();}
});

live('live server Unicode collation domains match the explicit supported ID windows',async()=>{
 const db=await connectDatabase(target);
 try{
  // Compare against the server's own catalogue, not another client.
  const result=await db.queryText(
   "SELECT ID, CHARACTER_SET_NAME AS charset_name FROM INFORMATION_SCHEMA.COLLATIONS WHERE ID IN (33,45,46,83) OR ID BETWEEN 192 AND 215 OR ID BETWEEN 224 AND 247 OR ID BETWEEN 255 AND 309");
  const catalog=new Map(result.rows.map(row=>[Number(row.ID),row.charset_name]));
  const windows=[33,45,46,83,...Array.from({length:24},(_,i)=>192+i),
   ...Array.from({length:24},(_,i)=>224+i),...Array.from({length:55},(_,i)=>255+i)];
  for(const id of windows){
   const name=catalog.get(id);
   if(name===undefined){
    assert.throws(()=>decodeMysqlText(Buffer.from('a'),id),/Unsupported MySQL result character-set/);
    continue;
   }
   assert.ok(name==='utf8mb3'||name==='utf8'||name==='utf8mb4','unexpected encoding for ID '+id);
   assert.equal(decodeMysqlText(Buffer.from('é中'),id),'é中');
   if(name==='utf8mb4')assert.equal(decodeMysqlText(Buffer.from('🚀'),id),'🚀');
   else assert.throws(()=>decodeMysqlText(Buffer.from('🚀'),id),/utf8mb3/);
  }
  for(const [charset,value] of [['utf8mb3','é中'],['utf8mb4','é中🚀']]){
   await db.queryText("SET SESSION character_set_results='"+charset+"'");
   const sql="SELECT CONVERT(_utf8mb4'"+value+"' USING "+charset+") AS value";
   for(const result of [await db.query(sql),await db.queryText(sql)]){
    assert.equal(result.rows[0].value,value);
    assert.ok(['utf8mb3','utf8','utf8mb4'].includes(catalog.get(result.columns[0].charset)),
     'expected selected Unicode collation');
   }
  }
 }finally{await db.close();}
});
