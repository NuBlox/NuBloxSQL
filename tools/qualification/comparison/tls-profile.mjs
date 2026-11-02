/**
 * A deliberately narrow, reproducible competitor profile.
 * Both clients must validate the same disposable MySQL 8.4.13 server CA and
 * certificate identity. This is benchmarking code, not part of @nublox/driver.
 */
import assert from 'node:assert/strict';

const isPem=x=>typeof x==='string'&&x.includes('-----BEGIN CERTIFICATE-----')&&
  x.includes('-----END CERTIFICATE-----');

export function createTlsComparisonProfile(env,ca,unrelatedCa){
  assert.equal(env.CI,'true','TLS comparisons require a disposable Actions fixture');
  assert.equal(env.GITHUB_ACTIONS,'true');
  assert.equal(env.NUBLOX_LIVE_MYSQL_TLS,'1');
  assert.equal(env.NUBLOX_TEST_MYSQL_VERSION,'8.4.13');
  assert.equal(env.NUBLOX_QUALIFICATION_MYSQL_VERSION,'8.4.13');
  assert.equal(env.MYSQL_TLS_PORT,'3307');
  assert.equal(env.MYSQL_DATABASE,'nublox_test');
  assert.match(env.GITHUB_SHA??'',/^[0-9a-f]{40}$/);
  assert.match(env.GITHUB_RUN_ID??'',/^\d{1,15}$/);
  assert.ok(isPem(ca)&&isPem(unrelatedCa)&&ca!==unrelatedCa,
    'Two distinct valid PEM CA certificates are required');
  const connection={
    host:'127.0.0.1',port:3307,user:env.MYSQL_USER??'root',
    password:env.MYSQL_PASSWORD??'test-password',database:'nublox_test'
  };
  return Object.freeze({
    transport:'verified-tls',
    nativeTarget:Object.freeze({engine:'mysql',...connection,
      security:'verified-tls',serverName:'localhost',ca,timeoutMs:30000}),
    peerOptions:()=>({host:connection.host,port:connection.port,
      user:connection.user,password:connection.password,
      database:connection.database,connectTimeout:30000,
      multipleStatements:false,
      // Fresh per-open SSL options prevent implicit mysql2 session-ticket reuse
      // from skewing independently measured TLS connection handshakes.
      ssl:{ca,rejectUnauthorized:true,verifyIdentity:true}}),
    unrelatedCa
  });
}
const valueOf=rows=>{
  assert.ok(Array.isArray(rows)&&rows.length===1);
  return String(rows[0]?.Value??rows[0]?.value??'');
};
/**
 * Independently exercise both clients before the timed benchmark.
 * All failures and error messages are kept out of qualification JSON.
 */
export async function verifyTlsComparisonProfile({connectNative,connectPeer,profile}){
  assert.ok(profile?.transport==='verified-tls');
  let native,peer;
  try{
    native=await connectNative(profile.nativeTarget);
    assert.match(native.info.version,/^8\.4\.13(?:[-+].*)?$/);
    assert.equal(native.info.transport,'verified-tls');
    let result=await native.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
    assert.ok(valueOf(result.rows).length>0,'Native connection is not using TLS');
    result=await native.query('SELECT @@global.require_secure_transport AS required');
    assert.equal(Number(result.rows[0].required),1);
    peer=await connectPeer(profile.peerOptions());
    let [rows]=await peer.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
    assert.ok(valueOf(rows).length>0,'mysql2 connection is not using TLS');
    [rows]=await peer.query('SELECT @@global.require_secure_transport AS required');
    assert.equal(Number(rows[0].required),1);
  }finally{
    await Promise.allSettled([
      native?.close(),
      peer?.end()
    ]);
  }
  // If either client unexpectedly accepts the unrelated CA, the benchmark
  // must fail; close the accepted session to avoid a real socket leak.
  const wrongNative={...profile.nativeTarget,ca:profile.unrelatedCa};
  const wrongPeer=profile.peerOptions();
  wrongPeer.ssl.ca=profile.unrelatedCa;
  for(const open of [()=>connectNative(wrongNative),()=>connectPeer(wrongPeer)]){
    const outcome=await Promise.allSettled([open()]);
    if(outcome[0].status==='fulfilled'){
      const session=outcome[0].value;
      await (session?.close?.()??session?.end?.()??Promise.resolve()).catch(()=>{});
      throw Error('Comparison accepted an unrelated TLS certificate authority');
    }
  }
  return Object.freeze({
    serverRequiresTls:true,nativeCipherConfirmed:true,
    mysql2CipherConfirmed:true,nativeIdentityVerified:true,
    mysql2IdentityVerified:true,nativeUnrelatedCaRejected:true,
    mysql2UnrelatedCaRejected:true
  });
}

export const EXPECTED_TLS_CHECKS=Object.freeze({
  serverRequiresTls:true,nativeCipherConfirmed:true,
  mysql2CipherConfirmed:true,nativeIdentityVerified:true,
  mysql2IdentityVerified:true,nativeUnrelatedCaRejected:true,
  mysql2UnrelatedCaRejected:true
});
