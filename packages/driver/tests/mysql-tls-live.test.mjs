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
