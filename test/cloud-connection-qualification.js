'use strict';

const assert = require('node:assert/strict');
const sql = require('..');
const qualification = require('../scripts/CloudConnectionQualification');

const ENV = Object.freeze({
  NUBLOX_CLOUD_SERVICE: 'aws-rds-postgresql',
  NUBLOX_CLOUD_HOST: 'db.example.test',
  NUBLOX_CLOUD_USER: 'readonly_test',
  NUBLOX_CLOUD_PASSWORD: 'TOP_SECRET_DO_NOT_LOG',
  NUBLOX_CLOUD_DATABASE: 'app'
});
function configured(overrides) {
  return Object.assign({}, ENV, overrides || {});
}
function mockApi(actions) {
  actions = actions || {};
  const calls = [];
  return {
    cloudDatabaseRegistry: sql.cloudDatabaseRegistry,
    calls,
    createConnection(config) {
      calls.push({kind:'create', config});
      if (actions.failCreate) throw new Error('native create secret TOP_SECRET_DO_NOT_LOG');
      return {
        socket: actions.socket || {encrypted:true, authorized:true},
        secure: actions.secure === undefined ? true : actions.secure,
        async connect() {
          calls.push({kind:'connect'});
          if (actions.failConnect) throw new Error('native connect secret TOP_SECRET_DO_NOT_LOG');
        },
        async query(statement, options) {
          calls.push({kind:'query', statement, options});
          if (actions.failQuery) throw new Error('native query secret TOP_SECRET_DO_NOT_LOG');
          return actions.result || {rows:[{nublox_cloud_probe:1}]};
        },
        async end() {
          calls.push({kind:'end'});
          if (actions.failClose) throw new Error('native close secret TOP_SECRET_DO_NOT_LOG');
        }
      };
    }
  };
}
async function rejectsCode(promise, code) {
  await assert.rejects(promise, error => {
    assert.equal(error.code, code);
    assert.ok(!String(error.message).includes('TOP_SECRET'));
    return true;
  });
}

async function main() {
  const direct = qualification.plan(configured());
  assert.equal(direct.serviceId, 'aws-rds-postgresql');
  assert.equal(direct.dialect, 'postgresql');
  assert.equal(direct.config.ssl.mode, 'require');
  assert.equal(direct.config.ssl.rejectUnauthorized, true);
  assert.equal(direct.config.ssl.servername, ENV.NUBLOX_CLOUD_HOST);
  assert.equal(direct.config.port, 5432);
  assert.equal(direct.config.connectTimeout, 10000);
  assert.equal(direct.config.password, ENV.NUBLOX_CLOUD_PASSWORD);

  const explicit = qualification.plan(configured({
    NUBLOX_CLOUD_SERVICE: 'aws-rds-mysql',
    NUBLOX_CLOUD_HOST: '127.0.0.1',
    NUBLOX_CLOUD_SERVERNAME: 'trusted-db.example.test',
    NUBLOX_CLOUD_PORT: '3307',
    NUBLOX_CLOUD_CA_PEM: 'test CA'
  }));
  assert.equal(explicit.dialect, 'mysql');
  assert.equal(explicit.config.port, 3307);
  assert.equal(explicit.config.ssl.servername, 'trusted-db.example.test');
  assert.equal(explicit.config.ssl.ca, 'test CA');
  assert.equal(explicit.config.ssl.rejectUnauthorized, true);

  for (const serviceId of [
    'aws-rds-sqlserver', 'azure-sql', 'azure-sql-managed-instance'
  ]) {
    const sqlServerPlan = qualification.plan(configured({
      NUBLOX_CLOUD_SERVICE: serviceId,
      NUBLOX_CLOUD_HOST: '127.0.0.1',
      NUBLOX_CLOUD_SERVERNAME: 'sql.azure-certificate.example.test',
      NUBLOX_CLOUD_CA_PEM: 'trusted SQL Server CA'
    }));
    assert.equal(sqlServerPlan.dialect, 'sqlserver');
    assert.equal(sqlServerPlan.config.port, 1433);
    assert.equal(sqlServerPlan.config.tdsVersion, '7.4');
    assert.equal(sqlServerPlan.config.hostnameInCertificate,
      'sql.azure-certificate.example.test');
    assert.equal(sqlServerPlan.config.rejectUnauthorized, true);
    assert.equal(sqlServerPlan.config.readOnlyIntent, true);
    assert.equal(sqlServerPlan.config.ca, 'trusted SQL Server CA');
    assert.equal(sqlServerPlan.config.ssl, undefined,
      'SQL Server must not receive PG/MySQL TLS options');
    assert.equal(sqlServerPlan.config.user, ENV.NUBLOX_CLOUD_USER);
  }

  for (const input of [
    configured({NUBLOX_CLOUD_SERVICE: 'snowflake'}),
    configured({NUBLOX_CLOUD_SERVICE: 'aws-redshift'}),
    configured({NUBLOX_CLOUD_SERVICE: 'gcp-cloudsql-postgresql'}),
    configured({NUBLOX_CLOUD_SERVICE: 'unknown'}),
    configured({NUBLOX_CLOUD_PORT: '99999'}),
    configured({NUBLOX_CLOUD_PORT: '0'}),
    configured({NUBLOX_CLOUD_PORT: '5432x'}),
    configured({NUBLOX_CLOUD_HOST: 'https://db.example.test'}),
    configured({NUBLOX_CLOUD_HOST: '127.0.0.1'}),
    configured({NUBLOX_CLOUD_HOST: ''}),
    configured({NUBLOX_CLOUD_USER: ''}),
    configured({NUBLOX_CLOUD_DATABASE: ''}),
    configured({NUBLOX_CLOUD_PASSWORD: ''})
  ]) {
    assert.throws(() => qualification.plan(input),
      'invalid, unsupported or incomplete real cloud config must not reach TCP');
  }

  for (const service of ['aws-rds-postgresql','aws-aurora-postgresql',
     'azure-postgresql-flexible','aws-rds-mysql','aws-aurora-mysql',
     'azure-mysql-flexible', 'aws-rds-sqlserver', 'azure-sql',
     'azure-sql-managed-instance']) {
    const api = mockApi();
    const evidence = await qualification.run(configured({
      NUBLOX_CLOUD_SERVICE:service
    }), api);
    assert.equal(evidence.status,'passed');
    assert.equal(evidence.serviceId,service);
    assert.equal(evidence.checks.tlsEncryptionAndPeerVerification,'passed');
    assert.equal(evidence.checks.connectionCleanup,'passed');
    assert.equal(evidence.scope,'single-live-endpoint-smoke-not-provider-certification');
    assert.deepEqual(api.calls.map(c=>c.kind),['create','connect','query','end']);
    assert.equal(api.calls[2].statement,'SELECT 1 AS nublox_cloud_probe');
    assert.equal(api.calls[2].options.timeout,10000);
    assert.ok(!JSON.stringify(evidence).includes('TOP_SECRET_DO_NOT_LOG'));
    assert.ok(!JSON.stringify(evidence).includes('db.example.test'));
  }

  for (const [actions,code] of [
    [{failCreate:true},'CREATE_CONNECTION_FAILED'],
    [{failConnect:true},'CONNECT_FAILED'],
    [{socket:{encrypted:false,authorized:true}},'TLS_NOT_VERIFIED'],
    [{socket:{encrypted:true,authorized:false}},'TLS_NOT_VERIFIED'],
    [{failQuery:true},'READ_ONLY_QUERY_FAILED'],
    [{result:{rows:[]}},'READ_ONLY_RESULT_MISMATCH'],
    [{result:{rows:[{nublox_cloud_probe:2}]}},'READ_ONLY_RESULT_MISMATCH'],
    [{failClose:true},'CLOSE_FAILED']
  ]) {
    const api=mockApi(actions);
    await rejectsCode(qualification.run(configured(),api),code);
    if (!actions.failCreate) {
      assert.equal(api.calls.at(-1).kind,'end', 'cleanup must run on failure');
    }
  }
  await rejectsCode(qualification.run(configured({
    NUBLOX_CLOUD_SERVICE:'aws-rds-mysql'
  }),mockApi({secure:false})),'TLS_NOT_VERIFIED');

  for (const sqlServerFailure of [
    [{socket:{encrypted:false,authorized:true}},'TLS_NOT_VERIFIED'],
    [{socket:{encrypted:true,authorized:false}},'TLS_NOT_VERIFIED'],
    [{failQuery:true},'READ_ONLY_QUERY_FAILED'],
    [{failClose:true},'CLOSE_FAILED']
  ]) {
    await rejectsCode(qualification.run(configured({
      NUBLOX_CLOUD_SERVICE:'azure-sql'
    }), mockApi(sqlServerFailure[0])), sqlServerFailure[1]);
  }

  const neverConnect = mockApi();
  await assert.rejects(qualification.run(configured({
    NUBLOX_CLOUD_SERVICE:'mongodb-atlas'
  }),neverConnect),/UNSUPPORTED_SERVICE/);
  assert.equal(neverConnect.calls.length,0);

  console.log('NuBloxSQL managed-cloud qualification harness (offline security contract): PASS');
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
