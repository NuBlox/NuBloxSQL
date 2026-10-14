'use strict';

const assert = require('node:assert/strict');
const sql = require('..');

const technologies = sql.databaseTechnologyRegistry;
const cloud = sql.cloudDatabaseRegistry;
assert.equal(sql.DATABASE_TECHNOLOGY_REGISTRY_SCHEMA_VERSION, 1);
assert.equal(sql.CLOUD_DATABASE_REGISTRY_SCHEMA_VERSION, 1);
assert.equal(technologies.validate().valid, true);
assert.deepEqual(technologies.validate().errors, []);
assert.equal(cloud.validate().valid, true);
assert.deepEqual(cloud.validate().errors, []);

const technologiesReport = technologies.report();
assert.equal(technologiesReport.schemaVersion, 1);
assert.equal(technologiesReport.counts.technologies, 20);
assert.equal(technologiesReport.counts.routable, 5);
assert.equal(technologiesReport.counts.relationalSqlProfiles, 100);
assert.strictEqual(technologies.relationalSqlProfiles, sql.dialectRegistry.products);
assert.equal(technologies.relationalSqlProfiles.find(x => x.id === 'oracle').driver.routable, false);
assert.equal(technologies.relationalSqlProfiles.find(x => x.id === 'snowflake').driver.routable, false);
assert.equal(technologies.relationalSqlProfiles.find(x => x.id === 'postgresql').driver.routable, true);
assert.ok(Object.isFrozen(technologiesReport));
assert.ok(Object.isFrozen(technologiesReport.technologies[0]));

for (const id of ['postgresql','mysql','sqlite','sqlserver']) {
  const t = technologies.get(id);
  assert.equal(t.runtime.adapter, id);
  assert.equal(t.runtime.routable, true);
  assert.equal(t.runtime.status, 'implemented');
  assert.equal(technologies.inspect(id).canConnect, true);
  assert.deepEqual(technologies.inspect(id).executableOperations, ['sql.query']);
}
for (const [id,model] of [
  ['mongodb','document'],['neo4j','graph'],
  ['cassandra','wide-column'],['elasticsearch','search'],
  ['influxdb','time-series'],['qdrant','vector'],['arangodb','graph']
]) {
  const record = technologies.get(id);
  assert.ok(record.models.includes(model));
  assert.equal(record.runtime.routable, false);
  assert.equal(record.runtime.status, 'not-implemented');
  assert.equal(record.runtime.qualification, 'none');
  assert.equal(record.sqlDialect, null);
  assert.equal(technologies.inspect(id).canConnect, false);
  assert.deepEqual(technologies.inspect(id).executableOperations, []);
  assert.ok(Object.isFrozen(record));
}
const redisTechnology = technologies.get('redis');
assert.equal(redisTechnology.runtime.routable, true);
assert.equal(redisTechnology.runtime.adapter, 'redis');
assert.equal(redisTechnology.runtime.qualification, 'initial');
assert.equal(redisTechnology.sqlDialect, null);
assert.deepEqual(technologies.inspect('redis').executableOperations,['key-value.command']);
assert.equal(typeof sql.createNativeConnection, 'function');
assert.ok(sql.createNativeConnection('redis') instanceof require('../lib/dialects/redis').RedisConnection);
assert.throws(()=>sql.createClient({dialect:'redis'}), /Unsupported NuBloxSQL dialect/);
assert.equal(technologies.get('PG'), technologies.get('postgresql'));
assert.equal(technologies.get('Mongo'), technologies.get('mongodb'));
assert.equal(technologies.get('unknown-vendor'), null);
assert.equal(technologies.inspect('unknown-vendor'), null);
assert.equal(technologies.list({model:'graph'}).length, 3);
assert.equal(technologies.list({routable:true}).length, 5);
assert.equal(technologies.list({nativeInterface:'cypher'}).length, 1);
assert.throws(() => technologies.get(''), /nonempty/);
for (const bad of [null,[],42,{model:'unknown'},{nativeInterface:'sqlish'},{routable:'yes'},{foo:true}]) {
  assert.throws(() => technologies.list(bad));
}
// Existing SQL routing is unchanged. Non-SQL catalogue entries remain unusable as SQL adapters.
for (const dialect of ['mongodb','redis','neo4j','cassandra','oracle','snowflake']) {
  assert.throws(() => sql.createClient({dialect}), /Unsupported NuBloxSQL dialect/);
}
assert.deepEqual(Object.keys(sql.DIALECTS).sort(), ['mysql','postgresql','sqlite','sqlserver']);

const report = cloud.report();
assert.equal(report.schemaVersion, 1);
assert.equal(report.counts.cloudQualified, 0);
assert.equal(report.counts.services, 26);
assert.equal(cloud.list({provider:'AWS'}).length, 10);
assert.ok(cloud.list({existingSqlAdapter:true}).length >= 10);
assert.equal(cloud.get('gcp-cloudsql-postgresql').connectionMethod, 'external-proxy');
assert.equal(cloud.get('azure-sql').existingSqlAdapter, 'sqlserver');
assert.equal(cloud.get('snowflake').existingSqlAdapter, null);
assert.equal(cloud.get('mongodb-atlas').existingSqlAdapter, null);
assert.equal(cloud.get('not-a-cloud-service'), null);
assert.ok(Object.isFrozen(report.services[0]));
assert.ok(Object.isFrozen(report.services[0].requirements));
for (const id of ['aws-rds-postgresql','aws-rds-mysql','aws-rds-sqlserver',
 'azure-sql','azure-postgresql-flexible','azure-mysql-flexible']) {
  const plan = cloud.planConnection({serviceId:id,endpoint:'db.example.com'});
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.status, 'requires-external-network-auth-and-tls-qualification');
  assert.equal(typeof plan.driverHint.dialect, 'string');
  assert.equal(plan.driverHint.host, 'db.example.com');
  assert.ok(plan.driverHint.port > 0);
  assert.ok(plan.requirements.transportSecurity.includes('verified'));
  assert.equal(plan.requirements.automaticTokenRefresh, false);
  assert.equal(plan.requirements.automaticProxyManagement, false);
  assert.ok(Object.isFrozen(plan));
  assert.ok(Object.isFrozen(plan.driverHint));
}
const proxy = cloud.planConnection({serviceId:'gcp-cloudsql-postgresql',
  endpoint:'127.0.0.1',port:5433});
assert.equal(proxy.driverHint.dialect,'postgresql');
assert.equal(proxy.driverHint.port,5433);
assert.equal(proxy.status,'requires-external-network-auth-and-tls-qualification');
assert.throws(() => cloud.planConnection({
  serviceId:'gcp-cloudsql-postgresql',endpoint:'my-remote.example.com'
}),/loopback/);
for (const id of ['snowflake','gcp-bigquery','databricks-sql','mongodb-atlas',
  'aws-dynamodb','azure-cosmos-db','clickhouse-cloud']) {
  const plan = cloud.planConnection({serviceId:id});
  assert.equal(plan.status, 'not-implemented');
  assert.equal(plan.driverHint, null);
  assert.ok(!JSON.stringify(plan).includes('password'));
}
assert.equal(sql.planCloudDatabaseConnection({serviceId:'snowflake'}).status,'not-implemented');
assert.deepEqual(sql.planCloudDatabaseConnection({
  serviceId:'aws-rds-postgresql',endpoint:'db.example.com'
}),cloud.planConnection({serviceId:'aws-rds-postgresql',endpoint:'db.example.com'}));
for (const input of [
  null, [], {},
  {serviceId:'not-known'},
  {serviceId:'aws-rds-postgresql'},
  {serviceId:'aws-rds-postgresql',endpoint:'https://db.example.com'},
  {serviceId:'aws-rds-postgresql',endpoint:'user:password@db.example.com'},
  {serviceId:'aws-rds-postgresql',endpoint:'db.example.com/tenant'},
  {serviceId:'aws-rds-postgresql',endpoint:'db.example.com',password:'secret'},
  {serviceId:'aws-rds-postgresql',endpoint:'db.example.com',port:0},
  {serviceId:'aws-rds-postgresql',endpoint:'db.example.com',port:70000},
  {serviceId:'aws-rds-postgresql',endpoint:'db.example.com',port:'5432'}
]) assert.throws(() => cloud.planConnection(input), 'must refuse invalid, unsafe or credential-bearing cloud plans');

assert.throws(() => cloud.list(null));
assert.throws(() => cloud.list({connectionMethod:'imaginary'}));
assert.throws(() => cloud.list({existingSqlAdapter:'yes'}));
assert.throws(() => cloud.list({notAFilter:'a'}));
console.log('NuBloxSQL universal database, SQL vendors and cloud placement catalogue: PASS');
