/** Hard-bound identity of disposable MySQL cache qualification fixtures.
 * Neither production drivers nor CLI tools alter server configuration. */
import {integerOption} from './metrics.mjs';

const isCertificate=value=>typeof value==='string'&&
  value.includes('-----BEGIN CERTIFICATE-----')&&
  value.includes('-----END CERTIFICATE-----');

export function cacheFixtureProfile(env,{concurrency,ca,unrelatedCa}={}){
  if(!env||typeof env!=='object'||
     env.CI!=='true'||env.GITHUB_ACTIONS!=='true'||
     env.NUBLOX_CACHE_BENCH_FIXTURE!=='1'||
     !/^[0-9a-f]{40}$/.test(env.GITHUB_SHA??'')||
     !/^[0-9]{1,15}$/.test(env.GITHUB_RUN_ID??''))
    throw Error('Cache qualification requires an identified disposable Actions run');

  const tls=env.NUBLOX_LIVE_MYSQL_TLS==='1';
  if(tls?env.NUBLOX_LIVE_MYSQL==='1':
    env.NUBLOX_LIVE_MYSQL!=='1')
    throw Error('Ambiguous or unapproved cache qualification transport');
  const expectedVersion=tls?'8.4.13':'8.4.11';
  const expectedConcurrency=tls?8:4;
  const port=tls?3307:3306;
  if(concurrency!==expectedConcurrency||
    env.NUBLOX_TEST_MYSQL_VERSION!==expectedVersion||
    env.NUBLOX_QUALIFICATION_MYSQL_VERSION!==expectedVersion||
    env.MYSQL_DATABASE!=='nublox_test'||
    (tls?env.MYSQL_TLS_PORT:env.MYSQL_PORT)!==String(port))
    throw Error('Unexpected cache qualification fixture identity or capacity');

  if(tls&&(!isCertificate(ca)||!isCertificate(unrelatedCa)||
    ca===unrelatedCa))
    throw Error('Verified TLS requires distinct trusted and unrelated CA certificates');
  if(!tls&&(ca!==undefined||unrelatedCa!==undefined))
    throw Error('Plaintext fixture must not receive TLS certificate material');

  // The maximum number of prepared statements is intentionally equal to
  // the number of physical sessions, so a transient +1 prepare must fail.
  const limit=integerOption(concurrency,{name:'global handle limit',min:4,max:8});
  const target=Object.freeze({
    engine:'mysql',host:'127.0.0.1',port,
    user:env.MYSQL_USER??'root',
    password:env.MYSQL_PASSWORD??'test-password',
    database:'nublox_test',
    security:tls?'verified-tls':'isolated-local',
    ...(tls?{serverName:'localhost',ca}:{}),
    timeoutMs:30000
  });
  return Object.freeze({
    target,limit,version:expectedVersion,
    transport:tls?'verified-tls':'isolated-local',
    unrelatedCa:tls?unrelatedCa:undefined
  });
}

/** Require actual TLS encryption, server policy, and negative CA validation
 * before profiling. No certificate or credential data enters reports. */
export async function verifyCacheTlsFixture({connect,observer,profile}){
  if(typeof connect!=='function'||!observer||
     profile?.transport!=='verified-tls')
    throw Error('Verified TLS fixture is required');
  if(observer.info.transport!=='verified-tls')
    throw Error('Native MySQL session did not establish verified TLS');
  const cipher=await observer.queryText("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
  const rows=cipher.rows;
  if(!Array.isArray(rows)||rows.length!==1||
     !String(rows[0]?.Value??rows[0]?.value??'').trim())
    throw Error('Native MySQL session did not negotiate a TLS cipher');
  const required=await observer.queryText(
    'SELECT @@global.require_secure_transport AS required');
  if(Number(required.rows[0]?.required)!==1)
    throw Error('Disposable MySQL fixture does not require secure transport');
  const wrongTarget={...profile.target,ca:profile.unrelatedCa};
  let unexpectedlyOpened;
  try{unexpectedlyOpened=await connect(wrongTarget);}
  catch{return Object.freeze({
    verifiedTransport:true,nonemptyCipher:true,
    serverRequiresTls:true,unrelatedCaRejected:true
  });}
  // An unexpected TLS acceptance must never leave a live socket.
  try{await unexpectedlyOpened?.close();}
  finally{throw Error('Native MySQL accepted an unrelated certificate authority');}
}
