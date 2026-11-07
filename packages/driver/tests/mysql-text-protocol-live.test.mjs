import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectDatabase,createDatabasePool} from '../dist/index.js';

const live=process.env.NUBLOX_LIVE_MYSQL==='1'?test:test.skip;
const target={
  engine:'mysql',host:'127.0.0.1',port:Number(process.env.MYSQL_PORT||3306),
  user:process.env.MYSQL_USER||'root',
  password:process.env.MYSQL_PASSWORD||'test-password',
  database:'nublox_test',security:'isolated-local',timeoutMs:30000
};

live('native COM_QUERY runs unparameterized non-preparable diagnostics',async()=>{
  const db=await connectDatabase(target);
  try{
    const warnings=await db.queryText('SHOW COUNT(*) WARNINGS');
    assert.equal(warnings.rows.length,1);
    assert.equal(warnings.columns.length,1);
    assert.equal(typeof Object.values(warnings.rows[0])[0],'bigint');
    const status=await db.queryText('SET @nublox_text_protocol = 41');
    assert.equal(status.rows.length,0);
    assert.equal(status.affectedRows,0);
    const answer=await db.queryText('SELECT @nublox_text_protocol AS answer');
    assert.equal(answer.rows[0].answer,41n);
    assert.equal(answer.rowValues[0][0],41n);
    assert.equal(db.closed,false);
  }finally{await db.close();}
});

live('COM_QUERY text decoder preserves result columns, duplicates and binary values',
  async()=>{
  const db=await connectDatabase(target);
  try{
    const r=await db.queryText(
      `SELECT 7 AS repeated, 8 AS repeated,
       CAST(UNHEX('00FF80') AS BINARY(3)) AS binary_field,
       CAST('12345678901234567890.1200' AS DECIMAL(24,4)) AS amount,
       CAST('{"big":12345678901234567890}' AS JSON) AS json_doc,
       'Schöne Grüße' AS greeting`
    );
    assert.equal(r.rows.length,1);
    assert.deepEqual(r.columnKeys.slice(0,2),['repeated','repeated#2']);
    assert.equal(r.rows[0].repeated,7n);
    assert.equal(r.rows[0]['repeated#2'],8n);
    assert.equal(r.rows[0].amount,'12345678901234567890.1200');
    assert.equal(r.rows[0].greeting,'Schöne Grüße');
    assert.equal(r.rows[0].json_doc,'{"big":12345678901234567890}');
    assert.deepEqual(r.rows[0].binary_field,Buffer.from([0,255,128]));
    assert.deepEqual(r.rowValues[0].slice(0,2),[7n,8n]);
    assert.equal(Object.getPrototypeOf(r.rows[0]),null);
    assert.equal(db.closed,false);
    assert.equal((await db.query('SELECT ? AS prepared_ok',[52])).rows[0].prepared_ok,52n);
  }finally{await db.close();}
});

live('native text CALL drains all results and remains reusable',async()=>{
  const db=await connectDatabase(target);
  try{
    const result=await db.queryTextResults('CALL nublox_multi_result(41)');
    assert.equal(result.length,3);
    assert.equal(result[0].rows[0].initial_value,41n);
    assert.equal(result[0].rows[0].label,'first');
    assert.equal(result[1].rows[0].second_value,42n);
    assert.equal(result[2].rows.length,0);
    await assert.rejects(db.queryText('CALL nublox_multi_result(41)'),
      error=>error.code==='UNSUPPORTED_FEATURE');
    assert.equal((await db.queryText('SELECT 53 AS healthy')).rows[0].healthy,53n);
  }finally{await db.close();}
});

live('native text errors can be recovered without corrupting next command',async()=>{
  const db=await connectDatabase(target);
  try{
    await assert.rejects(db.queryText('SELECT * FROM nublox_missing_text_table'),
      error=>error.code==='DATABASE_ERROR');
    assert.equal(db.closed,false);
    assert.equal((await db.queryText('SELECT 54 AS healthy')).rows[0].healthy,54n);
    await assert.rejects(db.queryText(''),
      error=>error.code==='INVALID_INPUT');
    assert.equal(db.closed,false);
  }finally{await db.close();}
});

live('text-protocol calls remain exclusively leased and pool-reset clean',async()=>{
  const pool=createDatabasePool(target,{maxConnections:1});
  try{
    const id=await pool.withConnection(async lease=>{
      const first=(await lease.queryText('SELECT CONNECTION_ID() AS id')).rows[0].id;
      await lease.queryText('SET @nublox_text_lease = 77');
      assert.equal((await lease.queryText(
        'SELECT @nublox_text_lease AS retained'
      )).rows[0].retained,77n);
      return first;
    });
    const second=await pool.withConnection(async lease=>{
      const result=await lease.queryText(
        'SELECT CONNECTION_ID() AS id, @nublox_text_lease AS cleared'
      );
      assert.equal(result.rows[0].cleared,null);
      return result.rows[0].id;
    });
    assert.equal(id,second);
    assert.equal(pool.stats.pending,0);
  }finally{await pool.close();}
});

live('managed transaction includes COM_QUERY status and rejects unexpected completion',
  async()=>{
  const db=await connectDatabase(target);
  try{
    const answer=await db.transaction(async tx=>{
      const r=await tx.queryText('SELECT 61 AS value');
      assert.equal(r.rows[0].value,61n);
      await tx.queryText('SET @nublox_text_tx = 63');
      assert.equal((await tx.queryTextResults(
        'SELECT @nublox_text_tx AS session_value'
      ))[0].rows[0].session_value,63n);
      return 'committed';
    });
    assert.equal(answer,'committed');
    await assert.rejects(db.transaction(async tx=>{
      await tx.queryText('COMMIT');
    }),error=>error.code==='TRANSACTION_OUTCOME_UNKNOWN');
    assert.equal(db.closed,true,
      'explicit in-transaction COMMIT must not be reported as managed success');
  }finally{await db.close();}
});

live('cancellation of running COM_QUERY terminates ambiguous session',
  {timeout:10000},async()=>{
  const db=await connectDatabase(target);
  const controller=new AbortController();
  const pending=db.queryText('SELECT SLEEP(3) AS waited',
    {signal:controller.signal});
  setTimeout(()=>controller.abort(),100);
  try{
    await assert.rejects(pending,error=>error.code==='CANCELLED');
    assert.equal(db.closed,true);
  }finally{await db.close();}
});

live('unexpected LOCAL INFILE request is rejected without transmitting file data',
  async()=>{
  const db=await connectDatabase(target);
  const original=db.get.bind(db);
  let packets=0;
  db.get=async()=>{if(++packets===1)return Buffer.from([0xfb,0x2f,0x2f]);
    return original();};
  try{
    await assert.rejects(db.queryText('SELECT 1'),
      error=>error.code==='UNSUPPORTED_FEATURE');
    assert.equal(db.closed,true);
  }finally{db.get=original;await db.close();}
});
