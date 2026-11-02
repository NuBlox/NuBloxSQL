import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTlsComparisonProfile,verifyTlsComparisonProfile,EXPECTED_TLS_CHECKS}
  from './comparison/tls-profile.mjs';

const pem=s=>'-----BEGIN CERTIFICATE-----\n'+s+'\n-----END CERTIFICATE-----';
const env={
  CI:'true',GITHUB_ACTIONS:'true',NUBLOX_LIVE_MYSQL_TLS:'1',
  NUBLOX_TEST_MYSQL_VERSION:'8.4.13',
  NUBLOX_QUALIFICATION_MYSQL_VERSION:'8.4.13',
  MYSQL_TLS_PORT:'3307',MYSQL_DATABASE:'nublox_test',
  MYSQL_USER:'root',MYSQL_PASSWORD:'test-password',
  GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'12345'
};
const ca=pem('correct-ca'),other=pem('incorrect-ca');
test('TLS comparator demands exact pinned disposable source and strict certificate options',()=>{
  const profile=createTlsComparisonProfile(env,ca,other);
  assert.equal(profile.nativeTarget.security,'verified-tls');
  assert.equal(profile.nativeTarget.serverName,'localhost');
  assert.equal(profile.nativeTarget.port,3307);
  const first=profile.peerOptions(),second=profile.peerOptions();
  assert.deepEqual(first.ssl,{ca,rejectUnauthorized:true,verifyIdentity:true});
  assert.notEqual(first.ssl,second.ssl,'Do not share mysql2 resumption cache');
  for(const key of ['CI','GITHUB_ACTIONS','NUBLOX_LIVE_MYSQL_TLS',
    'NUBLOX_TEST_MYSQL_VERSION','NUBLOX_QUALIFICATION_MYSQL_VERSION',
    'MYSQL_TLS_PORT','MYSQL_DATABASE','GITHUB_SHA','GITHUB_RUN_ID'])
    assert.throws(()=>createTlsComparisonProfile({...env,[key]:'wrong'},ca,other),key);
  for(const pair of [[null,other],[ca,'invalid'],[ca,ca]])
    assert.throws(()=>createTlsComparisonProfile(env,...pair));
});
function fixture({badNativeCipher=false,badPeerCipher=false,serverRequiresTls=true,
  acceptsWrongNative=false,acceptsWrongPeer=false}={}){
  let openedNative=0,closedNative=0,openedPeer=0,closedPeer=0;
  const status=bad=>({rows:[{Variable_name:'Ssl_cipher',
    Value:bad?'':'TLS_AES_256_GCM_SHA384'}]});
  const query=(sql,bad)=>{
    if(sql.includes('Ssl_cipher'))return status(bad);
    if(sql.includes('require_secure_transport'))
      return {rows:[{required:serverRequiresTls?1n:0n}]};
    throw Error('Unexpected preflight SQL');
  };
  const connectNative=async target=>{
    if(target.ca===other&&!acceptsWrongNative)throw Error('rejected');
    openedNative++;
    return {
      info:{version:'8.4.13',transport:'verified-tls'},
      query:async sql=>query(sql,badNativeCipher),
      close:async()=>{closedNative++;}
    };
  };
  const connectPeer=async options=>{
    assert.equal(options.ssl.verifyIdentity,true);
    assert.equal(options.ssl.rejectUnauthorized,true);
    if(options.ssl.ca===other&&!acceptsWrongPeer)throw Error('rejected');
    openedPeer++;
    return {
      query:async sql=>{
        const result=query(sql,badPeerCipher);return [result.rows];
      },
      end:async()=>{closedPeer++;}
    };
  };
  return {
    connectNative,connectPeer,
    get stats(){return {openedNative,closedNative,openedPeer,closedPeer};}
  };
}
test('comparator preflight verifies both real TLS client contracts and wrong-CA rejection',async()=>{
  const f=fixture();
  const checks=await verifyTlsComparisonProfile({...f,
    profile:createTlsComparisonProfile(env,ca,other)});
  assert.deepEqual(checks,EXPECTED_TLS_CHECKS);
  assert.deepEqual(f.stats,{openedNative:1,closedNative:1,openedPeer:1,closedPeer:1});
});
test('TLS comparative qualification fails closed on missing cipher, insecure server and invalid trust policy',async()=>{
  for(const settings of [{badNativeCipher:true},{badPeerCipher:true},
    {serverRequiresTls:false},{acceptsWrongNative:true},{acceptsWrongPeer:true}]){
    const f=fixture(settings);
    await assert.rejects(verifyTlsComparisonProfile({...f,
      profile:createTlsComparisonProfile(env,ca,other)}));
    assert.equal(f.stats.openedNative,f.stats.closedNative);
    assert.equal(f.stats.openedPeer,f.stats.closedPeer);
  }
});
