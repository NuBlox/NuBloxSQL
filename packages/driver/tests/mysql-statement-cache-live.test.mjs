import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectDatabase,createDatabasePool} from '../dist/index.js';

const live=process.env.NUBLOX_LIVE_MYSQL==='1'?test:test.skip;
const base={
  engine:'mysql',host:'127.0.0.1',port:Number(process.env.MYSQL_PORT||3306),
  user:process.env.MYSQL_USER||'root',
  password:process.env.MYSQL_PASSWORD||'test-password',
  database:'nublox_test',security:'isolated-local',timeoutMs:15000
};
const use=(statementCacheSize)=>({...base,statementCacheSize});

live('opt-in cache reuses exact SQL and native statement ID across binds',async()=>{
  const db=await connectDatabase(use(2));
  const originalPrepare=db.prepareNative.bind(db);
  const originalClose=db.closeNative.bind(db);
  let prepares=0,closes=0;
  db.prepareNative=async(...args)=>{prepares++;return originalPrepare(...args);};
  db.closeNative=async(...args)=>{closes++;return originalClose(...args);};
  try{
    const first=(await db.queryText('SELECT CONNECTION_ID() AS session_id'))
      .rows[0].session_id;
    for(let i=0;i<6;i++)
      assert.equal((await db.query('SELECT ? AS cached_value',[i]))
        .rows[0].cached_value,BigInt(i));
    assert.equal(prepares,1,'same literal SQL uses one COM_STMT_PREPARE');
    assert.equal(closes,0,'successfully reused statement stays allocated');
    const server=await db.queryText(
      "SELECT COUNT(*) AS n FROM performance_schema.prepared_statements_instances "+
      "WHERE SQL_TEXT = 'SELECT ? AS cached_value'"
    );
    assert.equal(server.rows[0].n,1n,'one server handle persists in this session');
    assert.equal((await db.queryText('SELECT CONNECTION_ID() AS session_id'))
      .rows[0].session_id,first);
    assert.equal(db.closed,false);
  }finally{
    db.prepareNative=originalPrepare;
    db.closeNative=originalClose;
    await db.close();
  }
});

live('LRU eviction closes oldest server statement without protocol desync',async()=>{
  const db=await connectDatabase(use(2));
  const originalClose=db.closeNative.bind(db);
  const closed=[];
  db.closeNative=async id=>{closed.push(id);return originalClose(id);};
  try{
    const sqlA='SELECT ? AS a',sqlB='SELECT ? AS b',sqlC='SELECT ? AS c';
    await db.query(sqlA,[1]);
    await db.query(sqlB,[2]);
    await db.query(sqlA,[3]); // promote A; B becomes oldest
    await db.query(sqlC,[4]); // evict B
    assert.equal(closed.length,1);
    const counts=await db.queryText(
      "SELECT SQL_TEXT AS stmt FROM performance_schema.prepared_statements_instances "+
      "WHERE SQL_TEXT IN ('SELECT ? AS a','SELECT ? AS b','SELECT ? AS c')"
    );
    assert.deepEqual(counts.rows.map(r=>r.stmt).sort(),
      [sqlA,sqlC].sort());
    await db.query(sqlB,[5]); // evict A
    assert.equal(closed.length,2);
    assert.equal((await db.query('SELECT ? AS b',[6])).rows[0].b,6n);
    assert.equal(db.closed,false);
  }finally{
    db.closeNative=originalClose;
    await db.close();
  }
});

live('invalid binds and recoverable server failures evict without automatic replay',async()=>{
  const db=await connectDatabase(use(2));
  const originalPrepare=db.prepareNative.bind(db);
  const originalClose=db.closeNative.bind(db);
  let prepares=0,closes=0;
  db.prepareNative=async(...args)=>{prepares++;return originalPrepare(...args);};
  db.closeNative=async(...args)=>{closes++;return originalClose(...args);};
  try{
    await db.query('SELECT ? AS value',[1]);
    assert.equal(prepares,1);
    await assert.rejects(db.query('SELECT ? AS value',[Infinity]),
      error=>error.code==='INVALID_INPUT');
    assert.equal(closes,1,'INVALID_INPUT must not leave a cached handle');
    assert.equal((await db.query('SELECT ? AS value',[2]))
      .rows[0].value,2n);
    assert.equal(prepares,2,'fresh handle after failed input');
    await assert.rejects(db.query('SELECT ? AS failure FROM nublox_statement_cache_missing_table',[1]),
      error=>error.code==='DATABASE_ERROR');
    assert.equal(db.closed,false);
    assert.equal((await db.query('SELECT ? AS value',[3]))
      .rows[0].value,3n);
    assert.equal(prepares,3,'SQL errors never replay submitted writes');
  }finally{
    db.prepareNative=originalPrepare;
    db.closeNative=originalClose;
    await db.close();
  }
});

live('pool COM_RESET_CONNECTION revokes cache before any subsequent lease',async()=>{
  const pool=createDatabasePool(use(2),{maxConnections:1});
  const sql='SELECT ? AS cache_lease';
  try{
    const first=await pool.withConnection(async db=>{
      const id=(await db.queryText('SELECT CONNECTION_ID() AS id')).rows[0].id;
      for(let i=0;i<3;i++)
        assert.equal((await db.query(sql,[i])).rows[0].cache_lease,BigInt(i));
      const active=await db.queryText(
        "SELECT COUNT(*) AS n FROM performance_schema.prepared_statements_instances "+
        "WHERE SQL_TEXT = 'SELECT ? AS cache_lease'"
      );
      assert.equal(active.rows[0].n,1n);
      return id;
    });
    await pool.withConnection(async db=>{
      assert.equal((await db.queryText('SELECT CONNECTION_ID() AS id'))
        .rows[0].id,first);
      const expired=await db.queryText(
        "SELECT COUNT(*) AS n FROM performance_schema.prepared_statements_instances "+
        "WHERE SQL_TEXT = 'SELECT ? AS cache_lease'"
      );
      assert.equal(expired.rows[0].n,0n,
        'reset must discard all cached native handle IDs');
      assert.equal((await db.query(sql,[42])).rows[0].cache_lease,42n);
    });
    assert.equal(pool.stats.discarded,0);
  }finally{await pool.close();}
});

live('explicit handles retain ownership when implicit cache is evicted for capacity',
  {timeout:35000},async()=>{
  const db=await connectDatabase(use(2));
  const holders=[];
  try{
    await db.query('SELECT ? AS implicit_handle',[1]);
    for(let i=0;i<127;i++)
      holders.push(await db.prepare('SELECT ? AS explicit_handle'));
    const last=await db.prepare('SELECT ? AS final_explicit');
    holders.push(last);
    assert.equal((await last.execute([88])).rows[0].final_explicit,88n);
    assert.equal((await holders[0].execute([89])).rows[0].explicit_handle,89n);
    await assert.rejects(db.query('SELECT ? AS new_implicit',[90]),
      error=>error.code==='RESOURCE_LIMIT');
    assert.equal(db.closed,true,
      'exhausted statement budget remains fail-closed inside serial operations');
    assert.ok(holders.every(statement=>statement.closed),
      'all explicit handles must be invalidated by connection revocation');
  }finally{
    await Promise.all(holders.map(s=>s.close()));
    await db.close();
  }
});

live('cancellation invalidates cached handle and native session',
  {timeout:10000},async()=>{
  const db=await connectDatabase(use(2));
  const controller=new AbortController();
  try{
    assert.equal((await db.query('SELECT ? AS stable',[41])).rows[0].stable,41n);
    const pending=db.query('SELECT SLEEP(?) AS blocked',[3],
      {signal:controller.signal});
    setTimeout(()=>controller.abort(),120);
    await assert.rejects(pending,error=>error.code==='CANCELLED');
    assert.equal(db.closed,true);
    await assert.rejects(db.query('SELECT ? AS stable',[42]),
      error=>error.code==='CONNECTION_CLOSED');
  }finally{await db.close();}
});

live('default uncached query lifecycle remains prepare-execute-close',async()=>{
  const db=await connectDatabase(base);
  const originalPrepare=db.prepareNative.bind(db);
  const originalClose=db.closeNative.bind(db);
  let prepares=0,closes=0;
  db.prepareNative=async(...args)=>{prepares++;return originalPrepare(...args);};
  db.closeNative=async(...args)=>{closes++;return originalClose(...args);};
  try{
    for(let i=0;i<3;i++)
      assert.equal((await db.query('SELECT ? AS default_value',[i]))
        .rows[0].default_value,BigInt(i));
    assert.equal(prepares,3);
    assert.equal(closes,3);
    assert.equal(db.closed,false);
  }finally{
    db.prepareNative=originalPrepare;
    db.closeNative=originalClose;
    await db.close();
  }
});

live('large literal SQL is executed but never retained as a cache key',async()=>{
  const db=await connectDatabase(use(2));
  const originalPrepare=db.prepareNative.bind(db);
  const originalClose=db.closeNative.bind(db);
  let prepares=0,closes=0;
  db.prepareNative=async(...args)=>{prepares++;return originalPrepare(...args);};
  db.closeNative=async(...args)=>{closes++;return originalClose(...args);};
  const statement='SELECT ? AS uncached_large /*'+'x'.repeat(8200)+'*/';
  try{
    for(let i=0;i<2;i++)
      assert.equal((await db.query(statement,[i]))
        .rows[0].uncached_large,BigInt(i));
    assert.equal(prepares,2);
    assert.equal(closes,2);
    assert.equal(db.closed,false);
  }finally{
    db.prepareNative=originalPrepare;
    db.closeNative=originalClose;
    await db.close();
  }
});

live('transactional implicit queries reuse one handle without escaping transaction',async()=>{
  const db=await connectDatabase(use(2));
  const originalPrepare=db.prepareNative.bind(db);
  let prepares=0;
  db.prepareNative=async(...args)=>{prepares++;return originalPrepare(...args);};
  try{
    const outcome=await db.transaction(async tx=>{
      for(let i=0;i<5;i++)
        assert.equal((await tx.query('SELECT ? AS within_transaction',[i]))
          .rows[0].within_transaction,BigInt(i));
      return 'committed';
    });
    assert.equal(outcome,'committed');
    assert.equal(prepares,1,'same server-owned prepared statement inside transaction');
    assert.equal((await db.query('SELECT ? AS within_transaction',[77]))
      .rows[0].within_transaction,77n);
    assert.equal(prepares,1);
    assert.equal(db.closed,false);
  }finally{
    db.prepareNative=originalPrepare;
    await db.close();
  }
});

live('failed unacknowledged cached eviction revokes the socket, never reuses it',async()=>{
  const db=await connectDatabase(use(1));
  const originalClose=db.closeNative.bind(db);
  try{
    assert.equal((await db.query('SELECT ? AS first',[1])).rows[0].first,1n);
    db.closeNative=async()=>{throw Error('injected close transport failure');};
    await assert.rejects(db.query('SELECT ? AS second',[2]),
      error=>error.code==='CONNECTION_CLOSED',
      'an uncertain native close must be classified as a closed connection');
    assert.equal(db.closed,true,
      'COM_STMT_CLOSE uncertainty must retire the native session');
    await assert.rejects(db.query('SELECT ? AS first',[3]),
      error=>error.code==='CONNECTION_CLOSED');
  }finally{
    db.closeNative=originalClose;
    await db.close();
  }
});
