import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectDatabase} from '../dist/index.js';
import {ADDITIONAL_MYSQL_COLLATIONS}
  from '../dist/vendors/mysql/collations.js';

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
