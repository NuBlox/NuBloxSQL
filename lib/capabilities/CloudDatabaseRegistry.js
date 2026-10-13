'use strict';

// Cloud placement and database engine are orthogonal.
// This is a credential-free connection requirements planner, NOT a connector,
// IAM token generator, proxy, tunnel, automatic TLS setup or live qualification.
const technologies = require('./DatabaseTechnologyRegistry');
const SCHEMA_VERSION = 1;
const DEPLOYMENT = Object.freeze(['managed-cloud','cloud-api','cloud-hosted']);
const METHODS = Object.freeze(['direct-tcp','external-proxy','service-api']);
const SOURCE = Object.freeze([
  ['aws-rds-postgresql','AWS','Amazon RDS for PostgreSQL','postgresql','direct-tcp',5432],
  ['aws-rds-mysql','AWS','Amazon RDS for MySQL','mysql','direct-tcp',3306],
  ['aws-rds-sqlserver','AWS','Amazon RDS for SQL Server','sqlserver','direct-tcp',1433],
  ['aws-aurora-postgresql','AWS','Amazon Aurora PostgreSQL','postgresql','direct-tcp',5432],
  ['aws-aurora-mysql','AWS','Amazon Aurora MySQL','mysql','direct-tcp',3306],
  ['azure-sql','Microsoft','Azure SQL Database','sqlserver','direct-tcp',1433],
  ['azure-sql-managed-instance','Microsoft','Azure SQL Managed Instance','sqlserver','direct-tcp',1433],
  ['azure-postgresql-flexible','Microsoft','Azure Database for PostgreSQL Flexible Server','postgresql','direct-tcp',5432],
  ['azure-mysql-flexible','Microsoft','Azure Database for MySQL Flexible Server','mysql','direct-tcp',3306],
  ['gcp-cloudsql-postgresql','Google','Cloud SQL for PostgreSQL','postgresql','external-proxy',5432],
  ['gcp-cloudsql-mysql','Google','Cloud SQL for MySQL','mysql','external-proxy',3306],
  ['gcp-cloudsql-sqlserver','Google','Cloud SQL for SQL Server','sqlserver','external-proxy',1433],
  ['snowflake','Snowflake','Snowflake','snowflake','service-api',null],
  ['gcp-bigquery','Google','BigQuery','bigquery','service-api',null],
  ['databricks-sql','Databricks','Databricks SQL','databricks','service-api',null],
  ['aws-redshift','AWS','Amazon Redshift','redshift','direct-tcp',5439],
  ['mongodb-atlas','MongoDB','MongoDB Atlas','mongodb','service-api',null],
  ['aws-dynamodb','AWS','DynamoDB','dynamodb','service-api',null],
  ['azure-cosmos-db','Microsoft','Azure Cosmos DB','cosmosdb','service-api',null],
  ['gcp-firestore','Google','Cloud Firestore','firestore','service-api',null],
  ['aws-documentdb','AWS','Amazon DocumentDB','mongodb','direct-tcp',27017],
  ['aws-keyspaces','AWS','Amazon Keyspaces','cassandra','service-api',null],
  ['aws-neptune','AWS','Amazon Neptune','neo4j','service-api',null],
  ['elastic-cloud','Elastic','Elastic Cloud','elasticsearch','service-api',null],
  ['clickhouse-cloud','ClickHouse','ClickHouse Cloud','clickhouse','service-api',null],
  ['redis-cloud','Redis','Redis Cloud','redis','direct-tcp',6379]
]);
const SQL_ADAPTERS = Object.freeze(['postgresql','mysql','sqlserver','sqlite']);
function freeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.values(o).forEach(freeze);
    Object.freeze(o);
  }
  return o;
}
function make(row) {
  const [id,provider,name,engine,method,defaultPort] = row;
  const technology = technologies.get(engine);
  const sqlAdapter = technology && technology.runtime.routable
    && SQL_ADAPTERS.includes(engine) && method !== 'service-api' ? engine : null;
  return freeze({
    id, provider, name, engine,
    deployment: method === 'service-api' ? 'cloud-api' : 'managed-cloud',
    connectionMethod: method,
    defaultPort,
    existingSqlAdapter: sqlAdapter,
    qualification: 'cloud-unqualified',
    requirements: {
      providerIdentity: 'separately-configured',
      databaseAuthentication: 'separately-configured',
      endpointNetworkAccess: 'must-be-established-by-caller',
      transportSecurity: 'must-be-verified-by-caller',
      automaticTokenRefresh: false,
      automaticProxyManagement: false
    },
    limitation: sqlAdapter
      ? 'Compatible base SQL protocol may be reachable; cloud network, TLS, IAM/Entra, authentication and engine-version behaviour have not been qualified by NuBloxSQL.'
      : 'Catalogue only. No NuBloxSQL adapter or cloud API connector is currently implemented for this service.'
  });
}
const SERVICES = freeze(SOURCE.map(make));
const BY_ID = Object.create(null);
for (const entry of SERVICES) BY_ID[entry.id] = entry;
Object.freeze(BY_ID);
function get(id) {
  if (typeof id !== 'string' || !id.trim()) throw new TypeError('cloud database service id must be a nonempty string');
  return BY_ID[id.trim().toLowerCase()] || null;
}
function list(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('cloud services filters must be an object');
  for (const key of Object.keys(options)) if (key !== 'provider' && key !== 'connectionMethod' && key !== 'existingSqlAdapter') {
    throw new TypeError('unknown cloud service filter: ' + key);
  }
  if (options.provider !== undefined && typeof options.provider !== 'string') throw new TypeError('provider must be a string');
  if (options.connectionMethod !== undefined && !METHODS.includes(options.connectionMethod)) throw new RangeError('unknown cloud connection method');
  if (options.existingSqlAdapter !== undefined && typeof options.existingSqlAdapter !== 'boolean') throw new TypeError('existingSqlAdapter must be boolean');
  return Object.freeze(SERVICES.filter(s =>
    (options.provider === undefined || s.provider.toLowerCase() === options.provider.trim().toLowerCase()) &&
    (options.connectionMethod === undefined || s.connectionMethod === options.connectionMethod) &&
    (options.existingSqlAdapter === undefined || Boolean(s.existingSqlAdapter) === options.existingSqlAdapter)
  ));
}
function assertEndpoint(value, label) {
  if (typeof value !== 'string' || !value.length || value.length > 253 ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value) || value.includes('..') ||
      value.startsWith('-') || value.endsWith('-') || value.includes('://')) {
    throw new TypeError(label + ' must be an endpoint hostname or IP without credentials, scheme or path');
  }
  return value;
}
function planConnection(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('cloud connection input must be an object');
  for (const key of Object.keys(input)) {
    if (key !== 'serviceId' && key !== 'endpoint' && key !== 'port') {
      throw new TypeError('cloud connection plan does not accept credentials or arbitrary fields: ' + key);
    }
  }
  const service = get(input.serviceId);
  if (!service) throw new RangeError('unknown cloud database service; no adapter has been selected');
  if (!service.existingSqlAdapter) {
    return freeze({
      schemaVersion: SCHEMA_VERSION, serviceId: service.id,
      status: 'not-implemented', driverHint: null,
      requirements: service.requirements, limitation: service.limitation
    });
  }
  const endpoint = assertEndpoint(input.endpoint, 'cloud connection endpoint');
  const port = input.port === undefined ? service.defaultPort : input.port;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new RangeError('cloud endpoint port must be 1..65535');
  if (service.connectionMethod === 'external-proxy' &&
      !['localhost','127.0.0.1','::1','[::1]'].includes(endpoint.toLowerCase())) {
    throw new RangeError('external proxy connection hint must use loopback; provision and secure the proxy separately');
  }
  return freeze({
    schemaVersion: SCHEMA_VERSION, serviceId: service.id,
    status: 'requires-external-network-auth-and-tls-qualification',
    driverHint: {dialect: service.existingSqlAdapter, host: endpoint, port},
    requirements: service.requirements,
    limitation: service.limitation
  });
}
function report() {
  return freeze({
    schemaVersion: SCHEMA_VERSION,
    counts: {
      services: SERVICES.length,
      potentialExistingSqlProtocol: SERVICES.filter(s => s.existingSqlAdapter).length,
      cloudQualified: 0
    },
    services: SERVICES
  });
}
function validate() {
  const errors = [], ids = new Set();
  for (const s of SERVICES) {
    if (ids.has(s.id)) errors.push('duplicate cloud service id ' + s.id);
    ids.add(s.id);
    if (!DEPLOYMENT.includes(s.deployment) || !METHODS.includes(s.connectionMethod)) errors.push('bad service classification ' + s.id);
    if (s.existingSqlAdapter && !technologies.get(s.existingSqlAdapter)?.runtime.routable) errors.push('unavailable adapter ' + s.id);
    if (s.qualification !== 'cloud-unqualified' || s.requirements.automaticTokenRefresh || s.requirements.automaticProxyManagement) errors.push('unsupported qualification claim ' + s.id);
  }
  return freeze({schemaVersion: SCHEMA_VERSION, valid: !errors.length, errors});
}
module.exports = Object.freeze({
  SCHEMA_VERSION, DEPLOYMENT, METHODS,
  services: SERVICES, get, list, planConnection, report, validate
});
