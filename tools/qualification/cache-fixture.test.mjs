import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cacheFixtureProfile,verifyCacheTlsFixture} from './cache-fixture.mjs';

const certificate='-----BEGIN CERTIFICATE-----\nunit-fixture\n-----END CERTIFICATE-----';
const unrelated='-----BEGIN CERTIFICATE-----\nunrelated\n-----END CERTIFICATE-----';
const base=Object.freeze({
  CI:'true',GITHUB_ACTIONS:'true',
  GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'123456',
  NUBLOX_CACHE_BENCH_FIXTURE:'1',MYSQL_DATABASE:'nublox_test',
  MYSQL_USER:'root',MYSQL_PASSWORD:'secret-not-for-reports'
});
const local=Object.freeze({
  ...base,NUBLOX_LIVE_MYSQL:'1',MYSQL_PORT:'3306',
  NUBLOX_TEST_MYSQL_VERSION:'8.4.11',
  NUBLOX_QUALIFICATION_MYSQL_VERSION:'8.4.11'
});
const tls=Object.freeze({
  ...base,NUBLOX_LIVE_MYSQL_TLS:'1',MYSQL_TLS_PORT:'3307',
  NUBLOX_TEST_MYSQL_VERSION:'8.4.13',
  NUBLOX_QUALIFICATION_MYSQL_VERSION:'8.4.13'
});
const tlsInputs={concurrency:8,ca:certificate,unrelatedCa:unrelated};

test('exact CI identity constrains loopback transport and server quota',()=>{
  const profile=cacheFixtureProfile(local,{concurrency:4});
  assert.equal(profile.transport,'isolated-local');
  assert.equal(profile.limit,4);
  assert.equal(profile.target.port,3306);
  assert.equal(profile.target.statementCacheSize,undefined);
  assert.equal(profile.target.host,'127.0.0.1');
  assert.equal(profile.target.security,'isolated-local');
  assert.ok(Object.isFrozen(profile));
  assert.ok(Object.isFrozen(profile.target));
});
test('eight-way verified TLS requires pinned identity and distinct certificate authorities',()=>{
  const profile=cacheFixtureProfile(tls,tlsInputs);
  assert.equal(profile.transport,'verified-tls');
  assert.equal(profile.limit,8);
  assert.equal(profile.target.security,'verified-tls');
  assert.equal(profile.target.port,3307);
  assert.equal(profile.target.serverName,'localhost');
  assert.equal(profile.target.ca,certificate);
  assert.equal(profile.unrelatedCa,unrelated);
});
test('incorrect mode, version, TLS identity, or capacities cannot run qualification',()=>{
  const broken=[
    [{...local,CI:'false'},{concurrency:4}],
    [{...local,GITHUB_ACTIONS:'false'},{concurrency:4}],
    [{...local,GITHUB_SHA:'not-a-sha'},{concurrency:4}],
    [{...local,GITHUB_RUN_ID:'oops'},{concurrency:4}],
    [{...local,NUBLOX_CACHE_BENCH_FIXTURE:'0'},{concurrency:4}],
    [{...local,MYSQL_PORT:'3333'},{concurrency:4}],
    [{...local,MYSQL_DATABASE:'production'},{concurrency:4}],
    [{...local,NUBLOX_TEST_MYSQL_VERSION:'8.4.13'},{concurrency:4}],
    [{...local,NUBLOX_QUALIFICATION_MYSQL_VERSION:'8.0.44'},{concurrency:4}],
    [{...local,NUBLOX_LIVE_MYSQL:'0'},{concurrency:4}],
    [{...local,NUBLOX_LIVE_MYSQL_TLS:'1'},{concurrency:4}],
    [local,{concurrency:8}],
    [local,{concurrency:4,ca:certificate}],
    [tls,{concurrency:4,ca:certificate,unrelatedCa:unrelated}],
    [{...tls,MYSQL_TLS_PORT:'3306'},tlsInputs],
    [{...tls,NUBLOX_TEST_MYSQL_VERSION:'9.7.4'},tlsInputs],
    [{...tls,NUBLOX_LIVE_MYSQL:'1'},tlsInputs],
    [tls,{concurrency:8,ca:certificate,unrelatedCa:certificate}],
    [tls,{concurrency:8,ca:'invalid',unrelatedCa:unrelated}],
    [tls,{concurrency:8,ca:certificate,unrelatedCa:'invalid'}]
  ];
  for(const [env,opts] of broken)
    assert.throws(()=>cacheFixtureProfile(env,opts));
});
function mockObserver({transport='verified-tls',cipher='TLS_AES_256_GCM_SHA384',required=1}={}){
  return {
    info:{transport},
    async queryText(sql){
      return sql.startsWith('SHOW')
        ?{rows:[{Value:cipher}]}
        :{rows:[{required:BigInt(required)}]};
    }
  };
}
test('verified TLS requires actual cipher, server-side policy and rejected unrelated CA',async()=>{
  const profile=cacheFixtureProfile(tls,tlsInputs);
  let attempts=0;
  const checks=await verifyCacheTlsFixture({
    profile,observer:mockObserver(),
    connect:async target=>{
      attempts++;
      assert.equal(target.ca,unrelated);
      throw new Error('untrusted CA');
    }
  });
  assert.deepEqual(checks,{
    verifiedTransport:true,nonemptyCipher:true,
    serverRequiresTls:true,unrelatedCaRejected:true
  });
  assert.equal(attempts,1);
});
test('TLS evidence cannot pass missing cipher, plaintext or a permissive CA',async()=>{
  const profile=cacheFixtureProfile(tls,tlsInputs);
  for(const observer of [
    mockObserver({transport:'isolated-local'}),
    mockObserver({cipher:''}),
    mockObserver({required:0})
  ])await assert.rejects(verifyCacheTlsFixture({
    profile,observer,connect:async()=>{throw Error('rejected');}
  }));
  let closed=false;
  await assert.rejects(verifyCacheTlsFixture({
    profile,observer:mockObserver(),
    connect:async()=>({async close(){closed=true;}})
  }),/accepted an unrelated certificate authority/);
  assert.equal(closed,true,'unexpectedly accepted TLS sessions must be closed');
});
