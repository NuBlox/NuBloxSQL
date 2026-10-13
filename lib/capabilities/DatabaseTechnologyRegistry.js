'use strict';

// Database technology catalogue is distinct from the SQL dialect registry.
// A catalogue record is NEVER a loadable adapter, permission or qualification claim.
const sqlDialects = require('./DialectRegistry');
const SCHEMA_VERSION = 1;
const MODELS = Object.freeze([
  'relational', 'document', 'key-value', 'graph', 'wide-column',
  'search', 'time-series', 'vector'
]);
const INTERFACES = Object.freeze([
  'sql', 'document-api', 'command-api', 'cypher', 'cql',
  'search-api', 'time-series-api', 'vector-api', 'multi-api'
]);
const OPERATIONS = Object.freeze([
  'sql.query', 'document.read', 'key-value.command', 'graph.query',
  'wide-column.query', 'search.query', 'time-series.query', 'vector.search'
]);
const SQL_RUNTIME = Object.freeze({
  postgresql: 1, mysql: 1, sqlite: 1, sqlserver: 2
});

// Models overlap and languages do not imply wire/protocol compatibility.
// Native interface names describe candidate future adapters, not implemented APIs.
const SOURCE = Object.freeze([
  ['postgresql','PostgreSQL','PostgreSQL',['relational'],['sql'],['sql.query']],
  ['mysql','Oracle','MySQL',['relational'],['sql'],['sql.query']],
  ['sqlite','SQLite','SQLite',['relational'],['sql'],['sql.query']],
  ['sqlserver','Microsoft','SQL Server',['relational'],['sql'],['sql.query']],
  ['mongodb','MongoDB','MongoDB',['document'],['document-api'],['document.read']],
  ['couchdb','Apache','CouchDB',['document'],['document-api'],['document.read']],
  ['redis','Redis','Redis',['key-value'],['command-api'],['key-value.command']],
  ['neo4j','Neo4j','Neo4j',['graph'],['cypher'],['graph.query']],
  ['cassandra','Apache','Cassandra',['wide-column'],['cql'],['wide-column.query']],
  ['scylladb','ScyllaDB','ScyllaDB',['wide-column'],['cql'],['wide-column.query']],
  ['dynamodb','Amazon','DynamoDB',['key-value','document'],['document-api'],['key-value.command','document.read']],
  ['elasticsearch','Elastic','Elasticsearch',['search','document'],['search-api'],['search.query']],
  ['opensearch','OpenSearch','OpenSearch',['search','document'],['search-api'],['search.query']],
  ['influxdb','InfluxData','InfluxDB',['time-series'],['time-series-api'],['time-series.query']],
  ['qdrant','Qdrant','Qdrant',['vector'],['vector-api'],['vector.search']],
  ['milvus','Milvus','Milvus',['vector'],['vector-api'],['vector.search']],
  ['arangodb','ArangoDB','ArangoDB',['document','graph'],['multi-api'],['document.read','graph.query']],
  ['cosmosdb','Microsoft','Azure Cosmos DB',['document','graph','key-value'],['multi-api'],['document.read','graph.query','key-value.command']],
  ['couchbase','Couchbase','Couchbase',['document'],['document-api'],['document.read']],
  ['firestore','Google','Cloud Firestore',['document'],['document-api'],['document.read']]
]);
const ALIASES = Object.freeze({
  pg: 'postgresql', postgres: 'postgresql', mssql: 'sqlserver',
  'sql-server': 'sqlserver', mongo: 'mongodb', 'azure-cosmos-db': 'cosmosdb'
});
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
function normalize(id) {
  if (typeof id !== 'string' || !id.trim()) {
    throw new TypeError('database technology id must be a nonempty string');
  }
  const normalized = id.trim().toLowerCase();
  return has(ALIASES, normalized) ? ALIASES[normalized] : normalized;
}
function makeRecord(row) {
  const [id,vendor,name,models,interfaces,operations] = row;
  const tier = has(SQL_RUNTIME, id) ? SQL_RUNTIME[id] : null;
  return deepFreeze({
    id, vendor, name,
    models: [...models], nativeInterfaces: [...interfaces],
    candidateOperations: [...operations],
    runtime: {
      routable: tier !== null,
      adapter: tier === null ? null : id,
      status: tier === null ? 'not-implemented' : 'implemented',
      qualification: tier === null ? 'none' : tier === 1 ? 'tier-1' : 'tier-2'
    },
    // SQL grammar models remain owned by the existing SQL-only registry.
    sqlDialect: tier === null ? null : id,
    limitation: tier === null
      ? 'Catalogue and native interface classification only. No runtime, connection or execution adapter exists.'
      : 'Use the existing SQL driver. Native capability and version qualification remain engine-specific.'
  });
}
const TECHNOLOGIES = deepFreeze(SOURCE.map(makeRecord));
const BY_ID = Object.create(null);
for (const entry of TECHNOLOGIES) BY_ID[entry.id] = entry;
Object.freeze(BY_ID);
function get(id) { return BY_ID[normalize(id)] || null; }
function list(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('database technology filters must be an object');
  }
  for (const key of Object.keys(options)) {
    if (key !== 'model' && key !== 'nativeInterface' && key !== 'routable') {
      throw new TypeError('unknown database technology filter: ' + key);
    }
  }
  if (options.model !== undefined && !MODELS.includes(options.model)) {
    throw new RangeError('unknown database model');
  }
  if (options.nativeInterface !== undefined && !INTERFACES.includes(options.nativeInterface)) {
    throw new RangeError('unknown database native interface');
  }
  if (options.routable !== undefined && typeof options.routable !== 'boolean') {
    throw new TypeError('routable must be a boolean');
  }
  return Object.freeze(TECHNOLOGIES.filter(item =>
    (options.model === undefined || item.models.includes(options.model)) &&
    (options.nativeInterface === undefined || item.nativeInterfaces.includes(options.nativeInterface)) &&
    (options.routable === undefined || item.runtime.routable === options.routable)
  ));
}
function inspect(id) {
  const technology = get(id);
  if (!technology) return null;
  return deepFreeze({
    schemaVersion: SCHEMA_VERSION, technology,
    canConnect: technology.runtime.routable,
    // Candidate operations only label native interface families.
    executableOperations: technology.runtime.routable ? ['sql.query'] : [],
    reason: technology.runtime.routable
      ? 'Existing SQL client; check version and operation capabilities before executing.'
      : 'No executable native adapter is registered. Catalogue membership never authorizes execution.'
  });
}
function report() {
  return deepFreeze({
    schemaVersion: SCHEMA_VERSION,
    counts: {
      technologies: TECHNOLOGIES.length,
      routable: TECHNOLOGIES.filter(t => t.runtime.routable).length,
      unimplemented: TECHNOLOGIES.filter(t => !t.runtime.routable).length,
      models: MODELS.length
    },
    models: MODELS,
    nativeInterfaces: INTERFACES,
    technologies: TECHNOLOGIES
  });
}
function validate() {
  const errors = [];
  const ids = new Set();
  for (const t of TECHNOLOGIES) {
    if (ids.has(t.id)) errors.push('duplicate database technology id: ' + t.id);
    ids.add(t.id);
    if (!t.models.length || t.models.some(m => !MODELS.includes(m))) errors.push('invalid models: ' + t.id);
    if (!t.nativeInterfaces.length || t.nativeInterfaces.some(i => !INTERFACES.includes(i))) errors.push('invalid interfaces: ' + t.id);
    if (!t.candidateOperations.length || t.candidateOperations.some(op => !OPERATIONS.includes(op))) errors.push('invalid operations: ' + t.id);
    const sql = sqlDialects.product(t.id);
    if (t.runtime.routable) {
      if (!sql || !sql.driver.routable || sql.driver.adapter !== t.id) errors.push('SQL runtime mismatch: ' + t.id);
      if (!t.models.includes('relational') || !t.nativeInterfaces.includes('sql')) errors.push('invalid SQL runtime classification: ' + t.id);
    } else if (t.runtime.adapter !== null || t.runtime.qualification !== 'none' || t.sqlDialect !== null) {
      errors.push('unimplemented adapter improperly qualified: ' + t.id);
    }
  }
  return deepFreeze({valid: errors.length === 0, errors, schemaVersion: SCHEMA_VERSION});
}
module.exports = Object.freeze({
  SCHEMA_VERSION, MODELS, INTERFACES, OPERATIONS, technologies: TECHNOLOGIES,
  get, list, inspect, report, validate
});
