import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {connectDatabase} from '../dist/index.js';

const live=process.env.NUBLOX_LIVE_MYSQL_TLS==='1'?test:test.skip;
const tlsPort=Number(process.env.MYSQL_TLS_PORT||3307);
const username=process.env.MYSQL_USER||'root';
const password=process.env.MYSQL_PASSWORD||'test-password';

function trustedTarget() {
  return {
    engine:'mysql',host:'127.0.0.1',port:tlsPort,
    user:username,password,database:'nublox_test',
    security:'verified-tls',serverName:'localhost',
    ca:readFileSync(process.env.NUBLOX_TLS_CA_FILE,'utf8'),
    timeoutMs:12000
  };
}

live('verified MySQL 8.4 TLS: trusted CA, hostname, authenticated session and prepared query',async()=>{
  const target=trustedTarget();
  const session=await connectDatabase(target);
  try{
    assert.equal(session.info.transport,'verified-tls');
    assert.match(session.info.version,/^8\.4\./);
    assert.equal(session.info.authPlugin,'caching_sha2_password');
    const result=await session.query('SELECT ? AS greeting, ? AS number',['TLS connected',42]);
    assert.equal(result.rows[0].greeting,'TLS connected');
    assert.equal(result.rows[0].number,42n);

    // Prove that this exact MySQL session reports a negotiated cipher,
    // not just that the client requested secure transport.
    const status=await session.query(
      "SELECT VARIABLE_VALUE AS cipher FROM performance_schema.session_status WHERE VARIABLE_NAME = 'Ssl_cipher'"
    );
    assert.equal(status.rows.length,1);
    assert.equal(typeof status.rows[0].cipher,'string');
    assert.ok(status.rows[0].cipher.length>0,'MySQL session must report an active TLS cipher');
  }finally{
    await session.close();
  }
  assert.equal(session.closed,true);
});

live('verified MySQL 8.4 TLS: untrusted CA fails closed',async()=>{
  const target={...trustedTarget(),ca:readFileSync(process.env.NUBLOX_TLS_OTHER_CA_FILE,'utf8')};
  await assert.rejects(connectDatabase(target),error=>error?.code==='TLS_FAILED');
});

live('verified MySQL 8.4 TLS: mismatched server identity fails closed',async()=>{
  const target={...trustedTarget(),serverName:'not-localhost.invalid'};
  await assert.rejects(connectDatabase(target),error=>error?.code==='TLS_FAILED');
});

live('verified MySQL 8.4 TLS: no trusted CA fails closed',async()=>{
  const {ca,...target}=trustedTarget();
  await assert.rejects(connectDatabase(target),error=>error?.code==='TLS_FAILED');
});

live('verified MySQL 8.4 TLS: invalid credentials fail without exposing password',async()=>{
  const secret='NUBLOX_NEVER_LOG_THIS_PASSWORD_4917';
  const target={...trustedTarget(),password:secret};
  await assert.rejects(connectDatabase(target),error=>{
    assert.equal(error?.code,'DATABASE_ERROR');
    assert.ok(error.vendorCode>0);
    assert.ok(!String(error.message).includes(secret),'Never return credentials in an authentication error');
    return true;
  });
});

live('TLS-required MySQL 8.4 rejects attempted plaintext connection',async()=>{
  const t=trustedTarget();
  const target={...t,security:'isolated-local'};
  delete target.ca;
  delete target.serverName;
  await assert.rejects(connectDatabase(target),error=>error instanceof Error);
});

live('TLS connections recover after rejected certificate and authentication attempts',async()=>{
  const target=trustedTarget();
  for(let i=0;i<3;i++){
    await assert.rejects(connectDatabase({...target,serverName:'mismatch.invalid'}),error=>error?.code==='TLS_FAILED');
    const session=await connectDatabase(target);
    try{
      const rows=(await session.query('SELECT ? AS round_trip',[i])).rows;
      assert.equal(rows[0].round_trip,BigInt(i));
    }finally{await session.close();}
  }
});


live('verified TLS cancellation drops affected socket; a new secured session succeeds',async()=>{
  const target=trustedTarget();
  const db=await connectDatabase(target);
  const controller=new AbortController();
  const pending=db.query('SELECT SLEEP(3) AS slept',[],{signal:controller.signal});
  setTimeout(()=>controller.abort(),120);
  await assert.rejects(pending,error=>error?.code==='CANCELLED');
  assert.equal(db.closed,true);
  await db.close();

  const fresh=await connectDatabase(target);
  try{
    assert.equal(fresh.info.transport,'verified-tls');
    assert.equal((await fresh.query('SELECT ? AS recovered',[73])).rows[0].recovered,73n);
  }finally{await fresh.close();}
});


live('verified-TLS pooled connections retain encryption and clear session state',async()=>{
 const {createDatabasePool}=await import('../dist/index.js');
 const pool=createDatabasePool(trustedTarget(),{maxConnections:1});
 try{
  const first=await pool.withConnection(async lease=>{
   assert.equal(lease.info.transport,'verified-tls');
   const id=(await lease.query('SELECT CONNECTION_ID() AS id')).rows[0].id;
   await lease.query('SET @nublox_tls_pool_marker = 9');
   return id;
  });
  const second=await pool.withConnection(async lease=>{
   assert.equal((await lease.query('SELECT @nublox_tls_pool_marker AS marker')).rows[0].marker,null);
   const status=await lease.query(
    "SELECT VARIABLE_VALUE AS cipher FROM performance_schema.session_status WHERE VARIABLE_NAME = 'Ssl_cipher'"
   );
   assert.ok(status.rows[0].cipher.length>0);
   return (await lease.query('SELECT CONNECTION_ID() AS id')).rows[0].id;
  });
  assert.equal(first,second,'verified TLS socket should be reused, not silently downgraded');
 }finally{await pool.close();}
});


live('verified TLS reusable native statement survives repeated execution and closes safely',async()=>{
  const db=await connectDatabase(trustedTarget());
  try{
    const statement=await db.prepare('SELECT ? AS secure_value');
    try{
      assert.equal(statement.parameterCount,1);
      for(let i=0;i<3;i++)
        assert.equal((await statement.execute([i])).rows[0].secure_value,BigInt(i));
    }finally{await statement.close();}
    assert.equal(statement.closed,true);
    await assert.rejects(statement.execute([4]),e=>e.code==='CONNECTION_CLOSED');
    assert.equal((await db.query('SELECT ? AS still_secure',[9])).rows[0].still_secure,9n);
  }finally{await db.close();}
});

live('verified TLS pooled prepared handles are revoked before another borrow',async()=>{
  const {createDatabasePool}=await import('../dist/index.js');
  const pool=createDatabasePool(trustedTarget(),{maxConnections:1});
  let escaped;
  let id;
  try{
    id=await pool.withConnection(async session=>{
      escaped=await session.prepare('SELECT ? AS encrypted_parameter');
      assert.equal((await escaped.execute(['yes'])).rows[0].encrypted_parameter,'yes');
      return (await session.query('SELECT CONNECTION_ID() AS id')).rows[0].id;
    });
    assert.equal(escaped.closed,true);
    await assert.rejects(escaped.execute(['no']),e=>e.code==='CONNECTION_CLOSED');
    const again=await pool.withConnection(async session=>
      (await session.query('SELECT CONNECTION_ID() AS id')).rows[0].id);
    assert.equal(again,id);
  }finally{await pool.close();}
});


live('verified TLS pool health checks keep the same encrypted MySQL connection',async()=>{
 const {createDatabasePool}=await import('../dist/index.js');
 const pool=createDatabasePool(trustedTarget(),{
  maxConnections:1,healthCheckTimeoutMs:1200,idleTimeoutMs:3000
 });
 try{
  const first=await pool.withConnection(async session=>{
    const cipher=await session.query(
      "SELECT VARIABLE_VALUE AS cipher FROM performance_schema.session_status WHERE VARIABLE_NAME = 'Ssl_cipher'"
    );
    assert.ok(cipher.rows[0].cipher.length>0);
    return (await session.query('SELECT CONNECTION_ID() AS id')).rows[0].id;
  });
  const second=await pool.withConnection(async session=>
    (await session.query('SELECT CONNECTION_ID() AS id')).rows[0].id);
  assert.equal(first,second);
  assert.equal(pool.stats.healthChecks,2);
  assert.equal(pool.stats.healthFailures,0);
  assert.equal(pool.stats.created,1);
 }finally{await pool.close();}
});


live('TLS-protected MySQL 8.4 text and binary conversions preserve result types',async()=>{
 const db=await connectDatabase(trustedTarget());
 try{
   const payload=Buffer.from([0,255,128,0]);
   const value='café 🚀 Zürich';
   const result=await db.query(
     'SELECT CAST(? AS CHAR CHARACTER SET utf8mb4) AS text_value, CAST(? AS BINARY(4)) AS binary_value, CAST(? AS DECIMAL(20,6)) AS amount',
     [value,payload,'123456789.000001']
   );
   assert.equal(result.rows[0].text_value,value);
   assert.deepEqual(result.rows[0].binary_value,payload);
   assert.equal(result.rows[0].amount,'123456789.000001');
 }finally{await db.close();}
});


live('verified TLS preserves duplicate aliases and positional rows over encrypted MySQL',async()=>{
 const db=await connectDatabase(trustedTarget());
 try{
   const result=await db.query('SELECT ? AS duplicate, ? AS duplicate, ? AS flag',
     [101,202,null]);
   assert.deepEqual(result.columns.map(c=>c.name),['duplicate','duplicate','flag']);
   assert.deepEqual(result.columnKeys,['duplicate','duplicate#2','flag']);
   assert.deepEqual(result.rowValues,[[101n,202n,null]]);
   assert.equal(result.rows[0].duplicate,101n);
   assert.equal(result.rows[0]['duplicate#2'],202n);
   assert.equal(result.rows[0].flag,null);
 }finally{await db.close();}
});


live('verified TLS preserves fragmented 17 MB MySQL Classic commands and result rows',async()=>{
 const db=await connectDatabase({...trustedTarget(),timeoutMs:30000});
 const size=17_000_000;
 try{
   const sent=await db.query('SELECT OCTET_LENGTH(?) AS sent',[Buffer.alloc(size,0x78)]);
   assert.equal(sent.rows[0].sent,BigInt(size));
   const received=await db.query('SELECT REPEAT(?,?) AS encrypted_payload',['z',size]);
   assert.equal(received.rows[0].encrypted_payload.length,size);
   assert.equal(received.rows[0].encrypted_payload.slice(0,2),'zz');
   assert.equal(received.rows[0].encrypted_payload.slice(-2),'zz');
   assert.equal((await db.query('SELECT ? AS usable',[18])).rows[0].usable,18n);
 }finally{await db.close();}
});
